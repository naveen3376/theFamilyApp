const AWS = require("aws-sdk");
const { v4: uuidv4 } = require('uuid');

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

const dynamoDB = new AWS.DynamoDB.DocumentClient();

// Get all shopping lists for a family
const getAllLists = async (familyId) => {
    const params = {
        TableName: 'ShoppingLists',
        KeyConditionExpression: 'familyid = :familyid',
        ExpressionAttributeValues: {
            ':familyid': familyId
        }
    };

    try {
        const result = await dynamoDB.query(params).promise();
        return result.Items;
    } catch (err) {
        console.error('Error in getAllLists:', err);
        throw err;
    }
};

// Create new shopping list
const createList = async (familyId, listName) => {
    const listId = uuidv4();
    const params = {
        TableName: 'ShoppingLists',
        Item: {
            familyid: familyId,
            listid: listId,
            listname: listName,
            items: {}
        }
    };

    try {
        await dynamoDB.put(params).promise();
        return params.Item;
    } catch (err) {
        console.error('Error in createList:', err);
        throw err;
    }
};

// Add item to list
const addItem = async (familyId, listId, itemName) => {
    const itemId = uuidv4();
    const params = {
        TableName: 'ShoppingLists',
        Key: {
            familyid: familyId,
            listid: listId
        },
        UpdateExpression: 'SET #items.#itemid = :itemValue',
        ExpressionAttributeNames: {
            '#items': 'items',
            '#itemid': itemId
        },
        ExpressionAttributeValues: {
            ':itemValue': {
                itemname: itemName,
                status: 'pending'
            }
        },
        ReturnValues: 'ALL_NEW'
    };

    try {
        const result = await dynamoDB.update(params).promise();
        return result.Attributes;
    } catch (err) {
        console.error('Error in addItem:', err);
        throw err;
    }
};

// Update item status
const updateItemStatus = async (familyId, listId, itemId, status) => {
    const params = {
        TableName: 'ShoppingLists',
        Key: {
            familyid: familyId,
            listid: listId
        },
        UpdateExpression: 'SET #items.#itemid.#status = :status',
        ExpressionAttributeNames: {
            '#items': 'items',
            '#itemid': itemId,
            '#status': 'status'
        },
        ExpressionAttributeValues: {
            ':status': status
        },
        ReturnValues: 'ALL_NEW'
    };

    try {
        const result = await dynamoDB.update(params).promise();
        return result.Attributes;
    } catch (err) {
        console.error('Error in updateItemStatus:', err);
        throw err;
    }
};

// Delete item
const deleteItem = async (familyId, listId, itemId) => {
    const params = {
        TableName: 'ShoppingLists',
        Key: {
            familyid: familyId,
            listid: listId
        },
        UpdateExpression: 'REMOVE #items.#itemid',
        ExpressionAttributeNames: {
            '#items': 'items',
            '#itemid': itemId
        }
    };

    try {
        await dynamoDB.update(params).promise();
        return true;
    } catch (err) {
        console.error('Error in deleteItem:', err);
        throw err;
    }
};


const getShoppingList = async (familyid) => {
    try {   
        const params = {
            TableName: "ShoppingLists",
            FilterExpression: "familyid = :familyid",
            ExpressionAttributeValues: { ":familyid": familyid },
        };
        const result = await dynamoDB.scan(params).promise();
        return result.Items || [];
    } catch (err) {
        console.error("Error fetching shopping list:", err);
        throw err;
    }
}

const addShoppingListItem = async (item) => {
    console.log(item);
    try {
        const params = {
            TableName: "ShoppingLists",
            Item: item
        };
        await dynamoDB.put(params).promise();
        return true;
    } catch (err) {
        console.error("Error adding item:", err);
        throw err;
    }
}

const updateShoppingListItem = async (params) => {
    try {
        const result = await dynamoDB.update(params).promise();
        return result;
    } catch (err) {
        console.error("Error updating item:", err);
        throw err;
    }
}
const deleteShoppingListItem = async (params) => {
    try {
        await dynamoDB.delete(params).promise();
        return true;
    } catch (err) {
        console.error("Error deleting item:", err);
        throw err;
    }
}

const updateFamily = async (params) => {
    try {
        const result = await dynamoDB.update(params).promise();
        return result;
    } catch (err) {
        console.error("Error updating family bank link:", err);
        throw err;
    }
}

async function createFamily(familyId, familyName, memberInfo) {
    const params = {
        TableName: "Families",
        Item: {
            familyid: familyId,
            familyname: familyName,
            owner: memberInfo.userid,
            members: [{
                userid: memberInfo.userid,
                name: memberInfo.name,
                email: memberInfo.email,
                nickname: memberInfo.nickname,
                birthday: memberInfo.birthday,
                role: memberInfo.role
            }]
        }
    };

    try {
        await dynamoDB.put(params).promise();
        return params.Item;
    } catch (error) {
        console.error("Error in createFamily:", error);
        throw error;
    }
}

async function addMemberToFamily(familyId, memberInfo) {
    const params = {
        TableName: "Families",
        Key: {
            familyid: familyId
        },
        UpdateExpression: "SET members = list_append(members, :newMember)",
        ExpressionAttributeValues: {
            ":newMember": [{
                email: memberInfo.email,
                nickname: memberInfo.nickname,
                birthday: memberInfo.birthday,
                role: memberInfo.role
            }]
        },
        ReturnValues: "ALL_NEW"
    };

    try {
        const result = await dynamoDB.update(params).promise();
        return result.Attributes;
    } catch (error) {
        console.error("Error in addMemberToFamily:", error);
        throw error;
    }
}

async function updateFamilyMember(familyId, userId, updates) {
    // First get the current family to find the member's index
    const getParams = {
        TableName: "Families",
        Key: {
            familyid: familyId
        }
    };

    try {
        const family = await dynamoDB.get(getParams).promise();
        const memberIndex = family.Item.members.findIndex(m => m.userid === userId);
        
        if (memberIndex === -1) {
            throw new Error("Member not found");
        }

        const updateParams = {
            TableName: "Families",
            Key: {
                familyid: familyId
            },
            UpdateExpression: "SET members[" + memberIndex + "].nickname = :nickname, members[" + memberIndex + "].birthday = :birthday",
            ExpressionAttributeValues: {
                ":nickname": updates.nickname,
                ":birthday": updates.birthday
            },
            ReturnValues: "ALL_NEW"
        };

        const result = await dynamoDB.update(updateParams).promise();
        return result.Attributes;
    } catch (error) {
        console.error("Error in updateFamilyMember:", error);
        throw error;
    }
}

async function removeMemberFromFamily(familyId, userId) {
    // First get the current family to find the member's index
    const getParams = {
        TableName: "Families",
        Key: {
            familyid: familyId
        }
    };

    try {
        const family = await dynamoDB.get(getParams).promise();
        const memberIndex = family.Item.members.findIndex(m => m.userid === userId);
        
        if (memberIndex === -1) {
            throw new Error("Member not found");
        }

        const updateParams = {
            TableName: "Families",
            Key: {
                familyid: familyId
            },
            UpdateExpression: `REMOVE members[${memberIndex}]`,
            ReturnValues: "ALL_NEW"
        };

        const result = await dynamoDB.update(updateParams).promise();
        return result.Attributes;
    } catch (error) {
        console.error("Error in removeMemberFromFamily:", error);
        throw error;
    }
}

// Update getFamilies to use DynamoDB query
async function getFamilies(userId) {
    const params = {
        TableName: "Families",
        FilterExpression: "contains(members[0].userid, :userid) OR contains(members[1].userid, :userid) OR contains(members[2].userid, :userid) OR contains(members[3].userid, :userid) OR contains(members[4].userid, :userid)",
        ExpressionAttributeValues: {
            ":userid": userId
        }
    };
    console.log("GetFamilies params:", params);
    try {
        const result = await dynamoDB.scan(params).promise();
        console.log("GetFamilies result:", result);
        return result.Items || [];
    } catch (error) {
        console.error("Error in getFamilies:", error);
        throw error;
    }
}

module.exports = { 
    getFamilies, 
    getShoppingList, 
    addShoppingListItem, 
    updateShoppingListItem, 
    deleteShoppingListItem, 
    updateFamily, 
    getAllLists, 
    createList, 
    addItem, 
    updateItemStatus, 
    deleteItem,
    createFamily,
    addMemberToFamily,
    updateFamilyMember,
    removeMemberFromFamily
};
