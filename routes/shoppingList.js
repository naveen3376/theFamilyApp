const express = require("express");
const { v4: uuidv4 } = require("uuid");
const { getAllLists, createList, addItem, updateItemStatus, deleteItem, updateFamily } = require("../utils/query");

let shoppingList = [];

// Middleware to check if user is authenticated
const isAuthenticated = (req, res, next) => {
    if (req.session && req.session.userinfo) {
        return next();
    }
    res.status(401).send("Unauthorized");
};

const isFamilyMember = (families) => {
    if (families.length > 0) {
        return true;
    }
    return false;
};

const router = express.Router();

// Get all shopping lists for a family
router.get('/', async (req, res) => {
    if (!req.session.tokens) {
        // Redirect to login page if the user is not logged in
        return res.redirect('/auth/login');
      }
    if (!isFamilyMember(req.session.userinfo.families)) {
        return res.redirect('/families');
    }
    try {
        const lists = await getAllLists(req.session.userinfo.families[0].familyid);
        const activeList = req.query.list ? 
            lists.find(l => l.listid === req.query.list) : 
            (lists.length > 0 ? lists[0] : null);

        // Ensure items object exists for active list
        if (activeList && !activeList.items) {
            activeList.items = {};
        }

        res.render('shoppingList', { 
            lists: lists || [],
            activeList: activeList
        });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).send('Server error');
    }
});

// Create new shopping list
router.post('/create', async (req, res) => {
    try {
        const newList = await createList(req.session.userinfo.families[0].familyid, req.body.name);
        res.json(newList);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).send('Server error');
    }
});

// Add item to list
router.post('/item', async (req, res) => {
    try {
        const updatedList = await addItem(req.session.userinfo.families[0].familyid, req.body.listId, req.body.name);
        res.json(updatedList);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).send('Server error');
    }
});

// Update item status
router.put('/item/:listId/:itemId', async (req, res) => {
    try {
        const updatedList = await updateItemStatus(
            req.session.userinfo.families[0].familyid,
            req.params.listId,
            req.params.itemId,
            req.body.status
        );
        res.json(updatedList);
    } catch (err) {
        console.error('Error:', err);
        res.status(500).send('Server error');
    }
});

// Delete item
router.delete('/item/:listId/:itemId', async (req, res) => {
    try {
        await deleteItem(req.session.userinfo.families[0].familyid, req.params.listId, req.params.itemId);
        res.json({ success: true });
    } catch (err) {
        console.error('Error:', err);
        res.status(500).send('Server error');
    }
});

module.exports = router;
