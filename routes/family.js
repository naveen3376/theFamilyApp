const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const AWS = require("aws-sdk");
const { getFamilies, createFamily, addMemberToFamily, removeMemberFromFamily, updateFamilyMember } = require("../utils/query");

if (process.env.NODE_ENV === "production") {
    // Use IAM role on EC2
    AWS.config.update({ region: process.env.AWS_REGION || "us-east-2" });
} else {
    // Use credentials from .env
    AWS.config.update({
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        region: process.env.AWS_REGION || "us-east-2",
    });
}
// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.userinfo) {
        return next();
    }
    res.status(401).send("Unauthorized");
};

const cognito = new AWS.CognitoIdentityServiceProvider();

// Create new family
router.post("/create", async (req, res) => {
    try {
        const familyId = uuidv4();
        const ownerId = req.session.userinfo.sub;
        const { familyname } = req.body;

        const memberInfo = {
            userid: ownerId,
            name: req.session.userinfo.name,
            email: req.session.userinfo.email,
            nickname: req.body.nickname || null,
            birthday: req.body.birthday || null,
            role: 'owner'
        };

        await createFamily(familyId, familyname, memberInfo);
        return res.status(200).json({ 
            message: 'Family created successfully',
            familyid: familyId 
        });
    } catch (error) {
        console.error("Error creating family:", error);
        res.status(500).json({ error: 'Failed to create family' });
    }
});

// Get user's families
router.get("/", async (req, res) => {
    try {
        const families = await getFamilies(req.session.userinfo.sub);
        res.json(families);
    } catch (error) {
        console.error("Error fetching families:", error);
        res.status(500).send("Failed to fetch families");
    }
});

// Invite member to family
router.post("/invite", async (req, res) => {
    try {
        const { email, nickname, birthday } = req.body;
        const familyId = req.session.userinfo.families[0].familyid;

        // First, check if the user already exists in Cognito
        try {
            const cognitoUser = await cognito.adminGetUser({
                UserPoolId: process.env.COGNITO_USER_POOL_ID,
                Username: email
            }).promise();
            
            // Get the sub (user id) from Cognito user attributes
            const sub = cognitoUser.UserAttributes.find(attr => attr.Name === 'sub').Value;
            
            // If user exists, add them to the family directly
            const memberInfo = {
                userid: sub,
                email,
                nickname: nickname || null,
                birthday: birthday || null,
                role: 'member'
            };

            await addMemberToFamily(familyId, memberInfo);
        } catch (error) {
            // User doesn't exist, create and send invitation email
            if (error.code === 'UserNotFoundException') {
                const params = {
                    UserPoolId: process.env.COGNITO_USER_POOL_ID,
                    TemporaryPassword: generateTemporaryPassword(),
                    Username: email,
                    UserAttributes: [
                        {
                            Name: 'email',
                            Value: email
                        },
                        {
                            Name: 'email_verified',
                            Value: 'true'
                        }
                    ]
                    // Removed MessageAction: 'SUPPRESS' to allow Cognito to send the email
                };

                // Create user in Cognito and it will automatically send the welcome email
                const newUser = await cognito.adminCreateUser(params).promise();
                const sub = newUser.User.Attributes.find(attr => attr.Name === 'sub').Value;

                // Add member to family with their Cognito user id
                const memberInfo = {
                    userid: sub,
                    email,
                    nickname: nickname || null,
                    birthday: birthday || null,
                    role: 'member'
                };

                await addMemberToFamily(familyId, memberInfo);
            } else {
                throw error;
            }
        }

        res.json({ success: true });
    } catch (error) {
        console.error("Error inviting member:", error);
        res.status(500).send("Failed to invite member");
    }
});

// Helper function to generate temporary password
function generateTemporaryPassword() {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    
    let password = '';
    
    // Ensure at least one of each required character type
    password += uppercase.charAt(Math.floor(Math.random() * uppercase.length));
    password += lowercase.charAt(Math.floor(Math.random() * lowercase.length));
    password += numbers.charAt(Math.floor(Math.random() * numbers.length));
    password += special.charAt(Math.floor(Math.random() * special.length));
    
    // Add additional random characters to reach minimum length of 12
    const allChars = uppercase + lowercase + numbers + special;
    for (let i = 0; i < 8; i++) {
        password += allChars.charAt(Math.floor(Math.random() * allChars.length));
    }
    
    // Shuffle the password to make it more random
    return password.split('').sort(() => Math.random() - 0.5).join('');
}

// Remove member from family
router.delete("/members/:userId", async (req, res) => {
    try {
        const familyId = req.session.userinfo.families[0].familyid;
        const { userId } = req.params;

        // Check if user is family owner
        if (req.session.userinfo.families[0].owner !== req.session.userinfo.sub) {
            return res.status(403).send("Only family owner can remove members");
        }

        await removeMemberFromFamily(familyId, userId);
        res.json({ success: true });
    } catch (error) {
        console.error("Error removing member:", error);
        res.status(500).send("Failed to remove member");
    }
});

// Update member information
router.put("/members/:userId", async (req, res) => {
    try {
        const familyId = req.session.userinfo.families[0].familyid;
        const { userId } = req.params;
        const { nickname, birthday } = req.body;

        // Only allow users to update their own info or family owner to update anyone
        if (userId !== req.session.userinfo.sub && 
            req.session.userinfo.families[0].owner !== req.session.userinfo.sub) {
            return res.status(403).send("Unauthorized to update member information");
        }

        const updates = {
            nickname: nickname || null,
            birthday: birthday || null
        };

        await updateFamilyMember(familyId, userId, updates);
        res.json({ success: true });
    } catch (error) {
        console.error("Error updating member:", error);
        res.status(500).send("Failed to update member information");
    }
});

router.get("/manage", async (req, res) => {
    try {
        // Fetch user's families
        const families = await getFamilies(req.session.userinfo.userid);
        
        res.render("familymanagement", {
            families: families,
            message: req.flash('message'),
            messageType: req.flash('messageType')
        });
    } catch (error) {
        console.error("Error loading family management page:", error);
        res.status(500).send("Error loading family management page");
    }
});

module.exports = router;
