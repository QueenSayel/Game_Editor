document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const API_URL_ITEMS = 'http://localhost:8080/items';
    const API_URL_CATEGORIES = 'http://localhost:8080/item-categories';
    const API_URL_DESCRIPTIONS = 'http://localhost:8080/item-descriptions';
    const AFFINITY_OPTIONS = ["None", "Frost", "Fire", "Lightning", "Water", "Divine", "Chaos"];

    // --- STATE MANAGEMENT ---
    let allItems = [];
    let itemCategories = {};
    let allDescriptions = {};
    let selectedItemId = null;
    let localUnsavedChanges = false;

    // --- DOM ELEMENTS ---
    const itemListContainer = document.getElementById('item-list');
    const itemForm = document.getElementById('item-form');
    const addNewItemBtn = document.getElementById('add-new-item-btn');
    const deleteItemBtn = document.getElementById('delete-item-btn');
    const itemOwnersListContainer = document.getElementById('item-owners-list');
    const formFields = {
        id: document.getElementById('itemId'), name: document.getElementById('itemName'),
        category: document.getElementById('itemCategory'), subCategory: document.getElementById('itemSubCategory'),
        type: document.getElementById('itemType'), damage: document.getElementById('itemDamage'),
        weight: document.getElementById('itemWeight'), value: document.getElementById('itemValue'),
        charge: document.getElementById('itemCharge'), affinity: document.getElementById('itemAffinity'),
        descCommon: document.getElementById('descCommon'), descLearned: document.getElementById('descLearned'),
        descForgotten: document.getElementById('descForgotten'),
    };

    // --- DATA HANDLING ---
    const loadItems = async () => {
        const response = await fetch(API_URL_ITEMS);
        if (!response.ok) throw new Error('Failed to fetch items from the server.');
        allItems = await response.json();
    };
    const loadCategories = async () => {
        const response = await fetch(API_URL_CATEGORIES);
        if (!response.ok) throw new Error('Failed to fetch item categories.');
        itemCategories = await response.json();
    };
    const loadDescriptions = async () => {
        const response = await fetch(API_URL_DESCRIPTIONS);
        if (!response.ok) throw new Error('Failed to fetch item descriptions.');
        allDescriptions = await response.json();
    };
    const saveItems = async () => {
        const response = await fetch(API_URL_ITEMS, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allItems, null, 2)
        });
        if (!response.ok) throw new Error('Failed to save items.');
    };
    const saveDescriptions = async () => {
        const response = await fetch(API_URL_DESCRIPTIONS, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allDescriptions, null, 2)
        });
        if (!response.ok) throw new Error('Failed to save descriptions.');
    };

    // --- UI RENDERING & MANAGEMENT ---
    const renderItemList = () => {
        const sortedItems = [...allItems].sort((a, b) => a.name.localeCompare(b.name));
        itemListContainer.innerHTML = '';
        if (sortedItems.length === 0) {
            itemListContainer.innerHTML = '<p class="placeholder-text">No items found. Add one!</p>';
            return;
        }
        sortedItems.forEach(item => {
            const itemElement = document.createElement('button');
            itemElement.className = 'list-item';
            itemElement.textContent = item.name || 'New Item';
            itemElement.dataset.id = item.id;
            if (item.id === selectedItemId) itemElement.classList.add('selected');
            itemElement.addEventListener('click', () => selectItem(item.id));
            itemListContainer.appendChild(itemElement);
        });
    };

    const renderItemOwners = (itemId) => {
        itemOwnersListContainer.innerHTML = '';
        if (!itemId || itemId.startsWith('temp_')) {
            itemOwnersListContainer.innerHTML = '<p class="placeholder-text">Save item to see owners.</p>';
            return;
        }
        const allNpcs = window.App.Npcs?.getAllNpcs() ?? [];
        const allCreatures = window.App.Creatures?.getAllCreatures() ?? [];
        
        let allOwners = [];

        // Find NPC owners
        allNpcs.forEach(npc => {
            const inventoryEntry = npc.inventory?.find(invItem => invItem.id === itemId);
            if (inventoryEntry) {
                allOwners.push({ type: 'npc', owner: npc, quantity: inventoryEntry.quantity });
            }
        });

        // Find Creature owners
        allCreatures.forEach(creature => {
            const inventoryEntry = creature.inventory?.find(invItem => invItem.id === itemId);
            if (inventoryEntry) {
                allOwners.push({ type: 'creature', owner: creature, quantity: inventoryEntry.quantity });
            }
        });

        if (allOwners.length === 0) {
            itemOwnersListContainer.innerHTML = '<p class="placeholder-text">No known owners.</p>';
            return;
        }

        allOwners.forEach(({ type, owner, quantity }) => {
            const ownerEl = document.createElement('div');
            ownerEl.className = 'owner-item';
            // UPDATED: Add data-owner-type attribute
            ownerEl.innerHTML = `
                <div class="owner-info">
                    <span class="owner-name">${owner.name}</span>
                    <span class="owner-quantity">(x${quantity})</span>
                </div>
                <button class="button-view" type="button" data-owner-type="${type}" data-owner-id="${owner.id}">View</button>
            `;
            itemOwnersListContainer.appendChild(ownerEl);
        });

        itemOwnersListContainer.querySelectorAll('.button-view').forEach(button => {
            button.addEventListener('click', (e) => {
                const ownerId = e.target.dataset.ownerId;
                const ownerType = e.target.dataset.ownerType;

                // UPDATED: Call the correct module based on type
                if (ownerType === 'npc') {
                    window.App.Npcs?.selectNpcById(ownerId);
                } else if (ownerType === 'creature') {
                    window.App.Creatures?.selectCreatureById(ownerId);
                }
            });
        });
    };

    const populateCategoryDropdown = () => {
        formFields.category.innerHTML = '<option value="">-- Select Category --</option>';
        for (const category in itemCategories) formFields.category.add(new Option(category, category));
    };
    const populateSubCategoryDropdown = (selectedCategory) => {
        const subCategorySelect = formFields.subCategory;
        subCategorySelect.innerHTML = '<option value="">-- Select Sub-Category --</option>';
        subCategorySelect.disabled = true;
        if (selectedCategory && itemCategories[selectedCategory]) {
            subCategorySelect.disabled = false;
            for (const subCategory in itemCategories[selectedCategory]) subCategorySelect.add(new Option(subCategory, subCategory));
        }
    };
    const populateTypeDropdown = (selectedCategory, selectedSubCategory) => {
        const typeSelect = formFields.type;
        typeSelect.innerHTML = '<option value="">-- Select Type --</option>';
        typeSelect.disabled = true;
        if (selectedCategory && selectedSubCategory && itemCategories[selectedCategory]?.[selectedSubCategory]) {
            typeSelect.disabled = false;
            itemCategories[selectedCategory][selectedSubCategory].forEach(type => typeSelect.add(new Option(type, type)));
        }
    };
    const populateAffinityDropdown = () => {
        formFields.affinity.innerHTML = '';
        AFFINITY_OPTIONS.forEach(opt => formFields.affinity.add(new Option(opt, opt)));
    };
    const populateForm = (item) => {
        itemForm.style.visibility = item ? 'visible' : 'hidden';
        deleteItemBtn.style.visibility = item ? 'visible' : 'hidden';
        if (!item) return;
        const isNewItem = item.id.startsWith('temp_');
        formFields.id.value = isNewItem ? '' : item.id;
        formFields.name.value = item.name;
        formFields.category.value = item.category || '';
        populateSubCategoryDropdown(item.category);
        formFields.subCategory.value = item.subCategory || '';
        populateTypeDropdown(item.category, item.subCategory);
        formFields.type.value = item.type || '';
        formFields.damage.value = item.stats.damage;
        formFields.weight.value = item.stats.weight;
        formFields.value.value = item.stats.value;
        formFields.charge.value = item.stats.charge;
        formFields.affinity.value = item.stats.affinity;
        const descriptions = allDescriptions[item.id] || {};
        formFields.descCommon.value = descriptions.common || '';
        formFields.descLearned.value = descriptions.learned || '';
        formFields.descForgotten.value = descriptions.forgotten || '';
    };

    // --- ACTIONS & EVENT HANDLERS ---
    const setUnsaved = () => {
        localUnsavedChanges = true;
        window.App.DataManager.setUnsavedChanges(true);
    };
    const generateUniqueId = (name, currentIdToIgnore = null) => {
        const baseId = 'item_' + name.toLowerCase().trim().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        if (!allItems.some(item => item.id === baseId && item.id !== currentIdToIgnore)) return baseId;
        let counter = 1;
        while (true) {
            let newId = `${baseId}_${String(counter).padStart(2, '0')}`;
            if (!allItems.some(item => item.id === newId && item.id !== currentIdToIgnore)) return newId;
            counter++;
        }
    };
    const selectItem = (id) => {
        selectedItemId = id;
        const currentItem = allItems.find(item => item.id === id);
        populateForm(currentItem);
        renderItemList();
        renderItemOwners(id);
    };
    const deleteSelectedItem = () => {
        if (!selectedItemId || !confirm('Are you sure you want to delete this item?')) return;
        delete allDescriptions[selectedItemId];
        allItems = allItems.filter(item => item.id !== selectedItemId);
        selectedItemId = null;
        populateForm(null);
        renderItemList();
        renderItemOwners(null);
        setUnsaved();
    };
    const handleFormChange = (event) => {
        if (!selectedItemId) return;
        const currentItemIndex = allItems.findIndex(item => item.id === selectedItemId);
        if (currentItemIndex === -1) return;
        const newName = formFields.name.value;
        let newId = selectedItemId;
        if (event && event.target.id === 'itemName') {
            const oldId = selectedItemId;
            if (newName.trim() !== '') {
                newId = generateUniqueId(newName, oldId);
                if (oldId !== newId) {
                    if (allDescriptions[oldId]) {
                        allDescriptions[newId] = { ...allDescriptions[oldId] };
                        delete allDescriptions[oldId];
                    }
                    selectedItemId = newId;
                }
            }
        }
        allItems[currentItemIndex] = {
            id: newId, name: newName, category: formFields.category.value,
            subCategory: formFields.subCategory.value, type: formFields.type.value,
            stats: {
                damage: parseInt(formFields.damage.value, 10) || 0,
                weight: parseFloat(formFields.weight.value) || 0,
                value: parseInt(formFields.value.value, 10) || 0,
                charge: parseInt(formFields.charge.value, 10) || 0,
                affinity: formFields.affinity.value,
            }
        };
        if (!allDescriptions[newId]) allDescriptions[newId] = {};
        allDescriptions[newId].common = formFields.descCommon.value;
        allDescriptions[newId].learned = formFields.descLearned.value;
        allDescriptions[newId].forgotten = formFields.descForgotten.value;
        setUnsaved();
        renderItemList();
        renderItemOwners(newId);
        formFields.id.value = newId.startsWith('temp_') ? '' : newId;
    };
    const addNewItem = () => {
        const tempId = `temp_${Date.now()}`;
        const newItem = {
            id: tempId, name: "", category: '', subCategory: '', type: '',
            stats: { damage: 0, weight: 0, value: 0, charge: 0, affinity: 'None' }
        };
        allItems.push(newItem);
        selectItem(newItem.id);
        formFields.name.focus();
        setUnsaved();
    };

    // --- INITIALIZATION ---
    const initializeEditor = async () => {
        try {
            // Register the module object immediately, but without the ready flag.
            window.App.Items = {
                save: async () => {
                    if (allItems.some(item => item.id.startsWith('temp_'))) {
                        throw new Error("Cannot save Items. Please provide a name for all new items first.");
                    }
                    await Promise.all([saveItems(), saveDescriptions()]);
                    localUnsavedChanges = false;
                },
                hasUnsavedChanges: () => localUnsavedChanges,
                getAllItems: () => allItems,
                isReady: false // UPDATED: Start as not ready
            };

            await Promise.all([loadCategories(), loadItems(), loadDescriptions()]);

            // Now that data is loaded, populate the UI
            populateCategoryDropdown();
            populateAffinityDropdown();
            renderItemList();
            populateForm(null);

            // UPDATED: Listen for changes from the NPC module
            document.addEventListener('npcDataChanged', () => {
                if (selectedItemId) {
                    renderItemOwners(selectedItemId);
                }
            });

            itemForm.addEventListener('input', handleFormChange);
            addNewItemBtn.addEventListener('click', addNewItem);
            deleteItemBtn.addEventListener('click', deleteSelectedItem);
            formFields.category.addEventListener('change', (e) => {
                populateSubCategoryDropdown(e.target.value);
                populateTypeDropdown(e.target.value, '');
                handleFormChange();
            });
            formFields.subCategory.addEventListener('change', (e) => {
                 populateTypeDropdown(formFields.category.value, e.target.value);
                 handleFormChange();
            });

            // UPDATED: Announce that this module is now fully loaded and ready.
            window.App.Items.isReady = true;
            document.dispatchEvent(new CustomEvent('itemsDataLoaded'));
            console.log("Items module initialized and data loaded.");

        } catch (error) {
            console.error('Items Initialization failed:', error);
            alert(`Failed to initialize the item editor.\n\nError: ${error.message}`);
        }
    };
    
    initializeEditor();
});