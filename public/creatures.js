document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const API_URL_CREATURES = 'http://localhost:8080/creatures';
    const AFFINITY_OPTIONS = ["None", "Frost", "Fire", "Lightning", "Water", "Divine", "Chaos"];

    // --- STATE MANAGEMENT ---
    let allCreatures = [];
    let allItems = [];
    let selectedCreatureId = null;
    let localUnsavedChanges = false;

    // --- DOM ELEMENTS ---
    const creatureListContainer = document.getElementById('creature-list');
    const creatureForm = document.getElementById('creature-form');
    const addNewCreatureBtn = document.getElementById('add-new-creature-btn');
    const deleteCreatureBtn = document.getElementById('delete-creature-btn');
    const inventoryListDiv = document.getElementById('creature-inventory-list');
    const inventoryAddSelect = document.getElementById('creature-inventory-add-select');
    const inventoryAddQty = document.getElementById('creature-inventory-add-qty');
    const inventoryAddBtn = document.getElementById('creature-inventory-add-btn');

    const formFields = {
        id: document.getElementById('creatureId'), name: document.getElementById('creatureName'),
        str: document.getElementById('creatureStatStr'), intel: document.getElementById('creatureStatInt'),
        wis: document.getElementById('creatureStatWis'), agi: document.getElementById('creatureStatAgi'),
        dex: document.getElementById('creatureStatDex'), cha: document.getElementById('creatureStatCha'),
        affinity: document.getElementById('creatureAffinity'),
        weakness: document.getElementById('creatureWeakness'),
    };

    // --- DATA HANDLING ---
    const loadCreatures = async () => {
        const response = await fetch(API_URL_CREATURES);
        if (!response.ok) throw new Error('Failed to fetch Creatures.');
        allCreatures = await response.json();
    };
    const saveCreatures = async () => {
        const response = await fetch(API_URL_CREATURES, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allCreatures, null, 2)
        });
        if (!response.ok) throw new Error('Failed to save Creatures.');
    };

    // --- UI RENDERING & MANAGEMENT ---
    const setUnsaved = () => {
        localUnsavedChanges = true;
        window.App.DataManager.setUnsavedChanges(true);
    };

    const notifyCreatureDataChanged = () => {
        document.dispatchEvent(new CustomEvent('creatureDataChanged'));
    };
    
    const renderCreatureList = () => {
        const sortedCreatures = [...allCreatures].sort((a, b) => a.name.localeCompare(b.name));
        creatureListContainer.innerHTML = '';
        if (sortedCreatures.length === 0) {
            creatureListContainer.innerHTML = '<p class="placeholder-text">No creatures found. Add one!</p>';
            return;
        }
        sortedCreatures.forEach(creature => {
            const el = document.createElement('button');
            el.className = 'list-item';
            el.textContent = creature.name || 'New Creature';
            el.dataset.id = creature.id;
            if (creature.id === selectedCreatureId) el.classList.add('selected');
            el.addEventListener('click', () => selectCreature(creature.id));
            creatureListContainer.appendChild(el);
        });
    };

    const initializeItemDependentUI = () => {
        allItems = window.App.Items.getAllItems();
        populateInventoryItemDropdown();
        if (selectedCreatureId) {
            const currentCreature = allCreatures.find(c => c.id === selectedCreatureId);
            populateForm(currentCreature);
        }
    };

    const populateInventoryItemDropdown = () => {
        const sortedItems = [...allItems].sort((a,b) => a.name.localeCompare(b.name));
        inventoryAddSelect.innerHTML = '<option value="">-- Select an Item --</option>';
        sortedItems.forEach(item => {
            if (!item.id || item.id.startsWith('temp_')) return;
            const displayText = `${item.name} [${item.id}]`;
            inventoryAddSelect.add(new Option(displayText, item.id));
        });
    };
    
    const renderInventoryList = (inventory = []) => {
        inventoryListDiv.innerHTML = '';
        if (inventory.length === 0) {
            inventoryListDiv.innerHTML = '<p class="placeholder-text" style="padding: 5px 0;">Empty Inventory</p>';
            return;
        }
        inventory.forEach((inventoryItem, index) => {
            const item = allItems.find(i => i.id === inventoryItem.id);
            const itemEl = document.createElement('div');
            itemEl.className = 'inventory-item';
            itemEl.innerHTML = `
                <span class="inventory-item-name" title="${item ? `${item.name} [${inventoryItem.id}]` : 'Unknown'}">${item ? `${item.name} [${inventoryItem.id}]` : `(Unknown Item: ${inventoryItem.id})`}</span>
                <input type="number" class="inventory-item-qty-editor" value="${inventoryItem.quantity}" min="1" data-index="${index}">
                <button type="button" data-index="${index}" class="remove-inventory-item-btn" title="Remove Item">×</button>
            `;
            inventoryListDiv.appendChild(itemEl);
        });
        
        document.querySelectorAll('.remove-inventory-item-btn').forEach(btn => {
            btn.addEventListener('click', (e) => removeInventoryItem(parseInt(e.target.dataset.index, 10)));
        });
        document.querySelectorAll('.inventory-item-qty-editor').forEach(input => {
            input.addEventListener('change', (e) => {
                const index = parseInt(e.target.dataset.index, 10);
                const newQuantity = parseInt(e.target.value, 10);
                updateInventoryItemQuantity(index, newQuantity, e.target);
            });
        });
    };

    const populateForm = (creature) => {
        creatureForm.style.visibility = creature ? 'visible' : 'hidden';
        deleteCreatureBtn.style.visibility = creature ? 'visible' : 'hidden';
        if (!creature) return;
        formFields.id.value = creature.id.startsWith('temp_') ? '' : creature.id;
        formFields.name.value = creature.name;
        formFields.str.value = creature.stats.strength;
        formFields.intel.value = creature.stats.intelligence;
        formFields.wis.value = creature.stats.wisdom;
        formFields.agi.value = creature.stats.agility;
        formFields.dex.value = creature.stats.dexterity;
        formFields.cha.value = creature.stats.charisma;
        formFields.affinity.value = creature.affinity;
        formFields.weakness.value = creature.weakness;
        renderInventoryList(creature.inventory);
    };

    // --- ACTIONS & EVENT HANDLERS ---
    const generateUniqueId = (name, currentIdToIgnore = null) => {
        const baseId = 'creature_' + name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        if (!allCreatures.some(c => c.id === baseId && c.id !== currentIdToIgnore)) return baseId;
        let counter = 1;
        while (true) {
            let newId = `${baseId}_${String(counter).padStart(2, '0')}`;
            if (!allCreatures.some(c => c.id === newId && c.id !== currentIdToIgnore)) return newId;
            counter++;
        }
    };
    const selectCreature = (id) => {
        selectedCreatureId = id;
        populateForm(allCreatures.find(c => c.id === id));
        renderCreatureList();
    };
    
    const selectCreatureById = (creatureId) => {
        const creatureTabButton = document.querySelector('button[data-tab="creatures"]');
        if (creatureTabButton && !creatureTabButton.classList.contains('active')) {
            creatureTabButton.click();
        }
        selectCreature(creatureId);
    };

    const deleteSelectedCreature = () => {
        if (!selectedCreatureId || !confirm('Are you sure you want to delete this Creature?')) return;
        allCreatures = allCreatures.filter(c => c.id !== selectedCreatureId);
        selectedCreatureId = null;
        populateForm(null);
        renderCreatureList();
        setUnsaved();
        notifyCreatureDataChanged();
    };
    const handleFormChange = (event) => {
        if (!selectedCreatureId) return;
        const creatureIndex = allCreatures.findIndex(c => c.id === selectedCreatureId);
        if (creatureIndex === -1) return;
        const newName = formFields.name.value;
        let newId = selectedCreatureId;
        if (event && event.target.id === 'creatureName' && newName.trim() !== '') {
            newId = generateUniqueId(newName, selectedCreatureId);
            if (newId !== selectedCreatureId) selectedCreatureId = newId;
        }
        allCreatures[creatureIndex] = { ...allCreatures[creatureIndex], id: newId, name: newName, affinity: formFields.affinity.value, weakness: formFields.weakness.value, stats: { strength: parseInt(formFields.str.value, 10) || 0, intelligence: parseInt(formFields.intel.value, 10) || 0, wisdom: parseInt(formFields.wis.value, 10) || 0, agility: parseInt(formFields.agi.value, 10) || 0, dexterity: parseInt(formFields.dex.value, 10) || 0, charisma: parseInt(formFields.cha.value, 10) || 0, } };
        setUnsaved();
        renderCreatureList();
        notifyCreatureDataChanged();
        formFields.id.value = newId.startsWith('temp_') ? '' : newId;
    };
    const addNewCreature = () => {
        const tempId = `temp_${Date.now()}`;
        const newCreature = { id: tempId, name: "", affinity: "None", weakness: "None", stats: { strength: 10, intelligence: 10, wisdom: 10, agility: 10, dexterity: 10, charisma: 10 }, inventory: [] };
        allCreatures.push(newCreature);
        selectCreature(newCreature.id);
        formFields.name.focus();
        setUnsaved();
    };
    const addInventoryItem = () => {
        if (!selectedCreatureId) return;
        const creatureIndex = allCreatures.findIndex(c => c.id === selectedCreatureId);
        if (creatureIndex === -1) return;
        const itemId = inventoryAddSelect.value;
        const quantity = parseInt(inventoryAddQty.value, 10);
        if (!itemId || !quantity || quantity < 1) {
            alert("Please select an item and enter a valid quantity (1 or more).");
            return;
        }
        const creature = allCreatures[creatureIndex];
        if (!creature.inventory) creature.inventory = [];
        const existingItem = creature.inventory.find(invItem => invItem.id === itemId);
        if (existingItem) {
            existingItem.quantity += quantity;
        } else {
            creature.inventory.push({ id: itemId, quantity: quantity });
        }
        renderInventoryList(creature.inventory);
        setUnsaved();
        notifyCreatureDataChanged();
        inventoryAddSelect.value = '';
        inventoryAddQty.value = '1';
    };
    const removeInventoryItem = (index) => {
        if (!selectedCreatureId) return;
        const creatureIndex = allCreatures.findIndex(c => c.id === selectedCreatureId);
        if (creatureIndex === -1) return;
        allCreatures[creatureIndex].inventory.splice(index, 1);
        renderInventoryList(allCreatures[creatureIndex].inventory);
        setUnsaved();
        notifyCreatureDataChanged();
    };
    const updateInventoryItemQuantity = (index, newQuantity, inputElement) => {
        if (!selectedCreatureId) return;
        const creatureIndex = allCreatures.findIndex(c => c.id === selectedCreatureId);
        if (creatureIndex === -1) return;
        if (isNaN(newQuantity) || newQuantity < 1) {
            newQuantity = 1;
            inputElement.value = newQuantity;
        }
        allCreatures[creatureIndex].inventory[index].quantity = newQuantity;
        setUnsaved();
        notifyCreatureDataChanged();
    };

    // --- INITIALIZATION ---
    const initializeEditor = async () => {
        try {
            window.App.Creatures = {
                save: async () => {
                    if (allCreatures.some(c => c.id.startsWith('temp_'))) {
                        throw new Error("Cannot save Creatures. Please provide a name for all new creatures first.");
                    }
                    await saveCreatures();
                    localUnsavedChanges = false;
                },
                hasUnsavedChanges: () => localUnsavedChanges,
                getAllCreatures: () => allCreatures,
                selectCreatureById: selectCreatureById
            };

            await loadCreatures();
            
            formFields.affinity.innerHTML = '';
            AFFINITY_OPTIONS.forEach(opt => formFields.affinity.add(new Option(opt, opt)));
            formFields.weakness.innerHTML = '';
            AFFINITY_OPTIONS.forEach(opt => formFields.weakness.add(new Option(opt, opt)));

            renderCreatureList();
            populateForm(null);

            if (window.App.Items?.isReady) {
                initializeItemDependentUI();
            } else {
                document.addEventListener('itemsDataLoaded', initializeItemDependentUI, { once: true });
            }

            creatureForm.addEventListener('input', handleFormChange);
            addNewCreatureBtn.addEventListener('click', addNewCreature);
            deleteCreatureBtn.addEventListener('click', deleteSelectedCreature);
            inventoryAddBtn.addEventListener('click', addInventoryItem);
            
            console.log("Creatures module initialized.");
			document.dispatchEvent(new CustomEvent('creaturesDataLoaded'));
        } catch (error) {
            console.error('Creatures Initialization failed:', error);
            alert(`Failed to initialize the Creature editor.\n\nError: ${error.message}`);
        }
    };
    
    initializeEditor();
});