document.addEventListener('DOMContentLoaded', () => {
    // --- CONFIGURATION ---
    const API_URL_DIALOGUE = '/.netlify/functions/dialogue';
    const API_URL_CLASS_RACE = '/.netlify/functions/class_race';

    // --- STATE ---
    let allDialogue = {};
    let classRaceData = {};
    let allItems = [];
    let allCharacters = [];
    let localUnsavedChanges = false;
    let selectedCharacterId = null;
    let selectedTopicId = null;
    let selectedNodeId = null;
    let contextMenuTargetInfo = null;
    let awesompleteInstance;
    let logicSuggestionLists = { base: [], items: [], classes: [], races: [] };

    // --- DRAWFLOW INSTANCE ---
    let editor;

    // --- DOM ELEMENTS ---
    const characterList = document.getElementById('dialogue-character-list');
    const topicList = document.getElementById('dialogue-topic-list');
    const addNewTopicBtn = document.getElementById('add-new-topic-btn');
    const addNpcNodeBtn = document.getElementById('add-npc-node-btn');
    const addPlayerNodeBtn = document.getElementById('add-player-node-btn');
    const detailsPanel = document.getElementById('dialogue-details-panel');
    const detailsPanelTitle = document.getElementById('details-panel-title');
    const detailsPanelContent = document.getElementById('details-panel-content');
    const detailsPanelCloseBtn = document.getElementById('details-panel-close-btn');
    const contextMenu = document.getElementById('custom-context-menu');

    // --- DATA HANDLING ---
    const loadDialogue = async () => allDialogue = await (await fetch(API_URL_DIALOGUE)).json();
    const loadClassRaceData = async () => classRaceData = await (await fetch(API_URL_CLASS_RACE)).json();
    const saveDialogue = async () => {
        if (selectedCharacterId && selectedTopicId) {
            allDialogue[selectedCharacterId][selectedTopicId].drawflow = editor.export();
        }
        const response = await fetch(API_URL_DIALOGUE, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(allDialogue, null, 2)
        });
        if (!response.ok) throw new Error('Failed to save dialogue.');
    };

    // --- UI RENDERING & MANAGEMENT ---
    const setUnsaved = () => {
        localUnsavedChanges = true;
        window.App.DataManager.setUnsavedChanges(true);
    };

    const compileCharacterList = () => {
        const npcs = (window.App.Npcs?.getAllNpcs() ?? []).map(c => ({ ...c, type: 'NPC' }));
        const creatures = (window.App.Creatures?.getAllCreatures() ?? []).map(c => ({ ...c, type: 'Creature' }));
        allCharacters = [...npcs, ...creatures].sort((a, b) => a.name.localeCompare(b.name));
    };
    
    const prepareSuggestionLists = () => {
        const baseCommands = [
            "has.read()", "has.item()", "not.has.item()", "is.class()", "not.is.class()", "is.weather()",
            "not.is.weather()", "is.time", "not.is.time", "is.date", "not.is.date", "is.race()",
            "not.is.race()", "has.flag()", "not.has.flag()", "has.skill()", "not.has.skill()",
            "is.gender()", "has.spell()", "not.has.spell()", "has.killed()", "not.has.killed()",
            "has.reputation()", "not.has.reputation()", "single", "greet", "set.flag()", "mod.reputation()",
            "mod.item()", "mod.skill()", "Fade:", "Color:"
        ];
        logicSuggestionLists.base = baseCommands.sort();
        allItems = window.App.Items.getAllItems();
        logicSuggestionLists.items = allItems.map(i => i.id);
        logicSuggestionLists.classes = classRaceData.classes || [];
        logicSuggestionLists.races = classRaceData.races || [];
    };
    
    const renderCharacterList = () => {
        characterList.innerHTML = '';
        allCharacters.forEach(char => {
            const el = document.createElement('button');
            el.className = 'list-item';
            el.textContent = `${char.name} [${char.type}]`;
            el.dataset.id = char.id;
            if (char.id === selectedCharacterId) el.classList.add('selected');
            el.addEventListener('click', () => selectCharacter(char.id));
            characterList.appendChild(el);
        });
    };
    
    const renderTopicList = () => {
        topicList.innerHTML = '';
        addNewTopicBtn.disabled = !selectedCharacterId;
        if (!selectedCharacterId || !allDialogue[selectedCharacterId]) return;
        Object.keys(allDialogue[selectedCharacterId]).forEach(topicId => {
            const topic = allDialogue[selectedCharacterId][topicId];
            const el = document.createElement('button');
            el.className = 'list-item';
            el.textContent = topic.topicName;
            el.dataset.id = topicId;
            if (topicId === selectedTopicId) el.classList.add('selected');
            el.addEventListener('click', () => selectTopic(topicId));
            topicList.appendChild(el);
        });
    };
    
    const renderDetailsPanel = (nodeId) => {
        const node = editor.getNodeFromId(nodeId);
        if (!node) {
            detailsPanel.classList.add('hidden');
            return;
        }
        const nodeData = node.data;
        
        const logicItemsHtml = (nodeData.logic || []).map((item, index) => 
            `<div class="logic-item-entry" data-index="${index}">${item}</div>`
        ).join('');

        detailsPanelTitle.textContent = `Details: ${node.name} #${node.id}`;
        detailsPanelContent.innerHTML = `
            <div class="form-group">
                <label>Dialogue Text</label>
                <textarea data-field="text" rows="4">${nodeData.text || ''}</textarea>
            </div>
            <div class="form-group">
                <label>Logic</label>
                <div class="logic-editor">
                    <input type="text" id="logic-input" class="awesomplete" placeholder="e.g., has.item(sword)">
                    <button id="add-logic-btn" class="button-primary">+</button>
                </div>
                <div id="logic-list-container" class="logic-list-container">
                    ${logicItemsHtml}
                </div>
            </div>
        `;
        
        const logicInput = document.getElementById('logic-input');
        awesompleteInstance = new Awesomplete(logicInput);
        awesompleteInstance.list = logicSuggestionLists.base;

        detailsPanel.classList.remove('hidden');
    };

    // --- ACTIONS & EVENT HANDLERS ---
    const selectCharacter = (charId) => {
        if (selectedCharacterId && selectedTopicId) {
            allDialogue[selectedCharacterId][selectedTopicId].drawflow = editor.export();
        }
        selectedCharacterId = charId;
        selectedTopicId = null;
        selectedNodeId = null;
        if (!allDialogue[charId]) allDialogue[charId] = {};
        renderCharacterList();
        renderTopicList();
        editor.clear();
        addNpcNodeBtn.disabled = true;
        addPlayerNodeBtn.disabled = true;
        detailsPanel.classList.add('hidden');
    };

    const selectTopic = (topicId) => {
        if (selectedCharacterId && selectedTopicId) {
            allDialogue[selectedCharacterId][selectedTopicId].drawflow = editor.export();
        }
        selectedTopicId = topicId;
        selectedNodeId = null;
        renderTopicList();
        const topic = allDialogue[selectedCharacterId][selectedTopicId];
        editor.import(topic.drawflow || { "drawflow": { "Home": { "data": {} } } });
        addNpcNodeBtn.disabled = false;
        addPlayerNodeBtn.disabled = false;
        detailsPanel.classList.add('hidden');
    };

    const addNode = (type) => {
        if (!selectedCharacterId || !selectedTopicId) return;
        const pos_x = editor.canvas_x + Math.floor(Math.random() * 200) + 50;
        const pos_y = editor.canvas_y + Math.floor(Math.random() * 100) + 50;
        
        const commonData = {
            text: '',
            logic: []
        };
        
        const nodeHtml = (badgeText, badgeClass) => `
            <div class="dialogue-node-header">
                ${badgeText} Node <span class="node-badge ${badgeClass}">${badgeText}</span>
            </div>
            <div class="dialogue-node-content"><p>...</p></div>
        `;

        if (type === 'NPC') {
            editor.addNode('npc-node', 1, 1, pos_x, pos_y, 'npc-node', { ...commonData }, nodeHtml('NPC', 'npc-badge'));
        } else if (type === 'Player') {
            editor.addNode('player-node', 1, 1, pos_x, pos_y, 'player-node', { ...commonData }, nodeHtml('Player', 'player-badge'));
        }
        setUnsaved();
    };

    const addNewTopic = () => {
        if (!selectedCharacterId) return;
        const topicName = prompt("Enter new topic name:");
        if (!topicName || topicName.trim() === '') return;
        const topicId = `topic_${topicName.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}`;
        allDialogue[selectedCharacterId][topicId] = { topicName, drawflow: { "drawflow": { "Home": { "data": {} } } } };
        setUnsaved();
        renderTopicList();
        selectTopic(topicId);
    };

    const updateAutocomplete = (inputValue) => {
        if (!awesompleteInstance) return;

        // Helper to escape strings for use in a RegExp
        const escapeRegExp = (string) => string.replace(/([.*+?^${}()|[\]\\])/g, '\\$1');

        const patterns = {
            'has.item(': logicSuggestionLists.items, 'not.has.item(': logicSuggestionLists.items,
            'mod.item(': logicSuggestionLists.items, 'is.class(': logicSuggestionLists.classes,
            'not.is.class(': logicSuggestionLists.classes, 'is.race(': logicSuggestionLists.races,
            'not.is.race(': logicSuggestionLists.races
        };

        let contextFound = false;

        for (const pattern in patterns) {
            // Create a regex to see if we are currently inside one of the function patterns
            const regex = new RegExp(escapeRegExp(pattern) + '[^)]*$', 'i');
            
            if (regex.test(inputValue)) {
                const sourceList = patterns[pattern];
                const fullCommandSuggestions = sourceList.map(item => `${pattern}${item})`);

                // Only update the list if it's not already the correct one
                // This prevents flickering and unnecessary re-evaluations
                if (JSON.stringify(awesompleteInstance.list) !== JSON.stringify(fullCommandSuggestions)) {
                    awesompleteInstance.list = fullCommandSuggestions;
                }
                
                awesompleteInstance.evaluate();
                contextFound = true;
                break; // We found the context, no need to check other patterns
            }
        }
        
        // If we are NOT in any special context, revert to the base list
        if (!contextFound && awesompleteInstance.list !== logicSuggestionLists.base) {
            awesompleteInstance.list = logicSuggestionLists.base;
            awesompleteInstance.evaluate();
        }
    };
    
    const handleDetailsPanelInteraction = (e) => {
        const target = e.target;
        if (!selectedNodeId) return;

        if (target.id === 'add-logic-btn') {
            const input = document.getElementById('logic-input');
            const value = input.value.trim();
            if (value) {
                const node = editor.getNodeFromId(selectedNodeId);
                if (!node.data.logic) node.data.logic = [];
                node.data.logic.push(value);
                editor.updateNodeDataFromId(selectedNodeId, node.data);
                renderDetailsPanel(selectedNodeId);
                document.getElementById('logic-input').focus();
                setUnsaved();
            }
        } else if (target.matches('input, textarea')) {
            if (e.type === 'input' && target.id === 'logic-input') {
                 updateAutocomplete(target.value);
            } else if (target.dataset.field === 'text') {
                const node = editor.getNodeFromId(selectedNodeId);
                node.data.text = target.value;
                editor.updateNodeDataFromId(selectedNodeId, node.data);
                
                const internalNode = editor.drawflow.drawflow.Home.data[selectedNodeId];
                const visualNode = document.querySelector(`#node-${selectedNodeId}`);
                if(visualNode && internalNode) {
                    const pElement = visualNode.querySelector('.dialogue-node-content p');
                    if (pElement) pElement.textContent = node.data.text || '...';
                    internalNode.html = visualNode.querySelector('.drawflow_content_node').innerHTML;
                }
                setUnsaved();
            }
        }
    };

    // --- INITIALIZATION ---
	const initializeEditor = async () => {
		try {
			const container = document.getElementById('drawflow');
			editor = new Drawflow(container);
			editor.reroute = true;
			editor.start();

			editor.on('nodeSelected', (id) => { selectedNodeId = id; renderDetailsPanel(id); });
			editor.on('nodeUnselected', () => { selectedNodeId = null; detailsPanel.classList.add('hidden'); });
			editor.on('nodeRemoved', () => {
				if (selectedNodeId && !editor.getNodeFromId(selectedNodeId)) {
					detailsPanel.classList.add('hidden');
					selectedNodeId = null;
				}
				setUnsaved();
			});
			['nodeCreated', 'nodeMoved', 'connectionCreated', 'connectionRemoved'].forEach(event => editor.on(event, setUnsaved));

			// --- THE CORRECTED ROBUST DATA LOADING ---
			// Wait for all dependency modules to fire their 'loaded' events.
			await Promise.all([
				new Promise(resolve => {
					if (window.App.Items?.isReady) return resolve();
					document.addEventListener('itemsDataLoaded', resolve, { once: true });
				}),
				new Promise(resolve => {
					// We just need to wait for the event, no need to check for a ready flag
					document.addEventListener('npcsDataLoaded', resolve, { once: true });
				}),
				new Promise(resolve => {
					// We just need to wait for the event
					document.addEventListener('creaturesDataLoaded', resolve, { once: true });
				})
			]);

			// Now that dependencies are ready, load our own data
			await Promise.all([loadDialogue(), loadClassRaceData()]);
			
			// Now it's safe to compile lists that depend on external data
			compileCharacterList();
			prepareSuggestionLists();
			renderCharacterList();
			renderTopicList();
			
			addNpcNodeBtn.disabled = true;
			addPlayerNodeBtn.disabled = true;
			
			// --- Event Listeners and the rest of the function ---
			addNewTopicBtn.addEventListener('click', addNewTopic);
			addNpcNodeBtn.addEventListener('click', () => addNode('NPC'));
			addPlayerNodeBtn.addEventListener('click', () => addNode('Player'));
			
			detailsPanelCloseBtn.addEventListener('click', () => {
				if (selectedNodeId) {
					const nodeElement = document.getElementById(`node-${selectedNodeId}`);
					if (nodeElement) nodeElement.classList.remove("selected");
				}
				selectedNodeId = null;
				detailsPanel.classList.add('hidden');
			});
			
			detailsPanelContent.addEventListener('click', handleDetailsPanelInteraction);
			detailsPanelContent.addEventListener('input', handleDetailsPanelInteraction, true);
			
			topicList.addEventListener('contextmenu', (e) => {
				const topicButton = e.target.closest('.list-item');
				if (!topicButton) return;
				e.preventDefault();
				contextMenuTargetInfo = { type: 'topic', id: topicButton.dataset.id };
				contextMenu.querySelector('[data-action="delete-topic"]').style.display = 'block';
				contextMenu.querySelector('[data-action="delete-logic"]').style.display = 'none';
				contextMenu.style.top = `${e.clientY}px`;
				contextMenu.style.left = `${e.clientX}px`;
				contextMenu.style.display = 'block';
			});

			detailsPanelContent.addEventListener('contextmenu', (e) => {
				const logicItem = e.target.closest('.logic-item-entry');
				if(!logicItem) return;
				e.preventDefault();
				contextMenuTargetInfo = { type: 'logic', index: parseInt(logicItem.dataset.index, 10) };
				contextMenu.querySelector('[data-action="delete-topic"]').style.display = 'none';
				contextMenu.querySelector('[data-action="delete-logic"]').style.display = 'block';
				contextMenu.style.top = `${e.clientY}px`;
				contextMenu.style.left = `${e.clientX}px`;
				contextMenu.style.display = 'block';
			});

			window.addEventListener('click', () => { contextMenu.style.display = 'none'; });

			contextMenu.addEventListener('click', (e) => {
				const action = e.target.dataset.action;
				if (action === 'delete-topic') {
					if (confirm(`Are you sure you want to delete topic?`)) {
						delete allDialogue[selectedCharacterId][contextMenuTargetInfo.id];
						if(selectedTopicId === contextMenuTargetInfo.id) {
							editor.clear();
							selectedTopicId = null;
							addNpcNodeBtn.disabled = true;
							addPlayerNodeBtn.disabled = true;
						}
						renderTopicList();
						setUnsaved();
					}
				} else if (action === 'delete-logic') {
					const node = editor.getNodeFromId(selectedNodeId);
					node.data.logic.splice(contextMenuTargetInfo.index, 1);
					editor.updateNodeDataFromId(selectedNodeId, node.data);
					renderDetailsPanel(selectedNodeId);
					setUnsaved();
				}
			});

			window.App.Dialogue = {
				save: async () => { await saveDialogue(); localUnsavedChanges = false; },
				hasUnsavedChanges: () => localUnsavedChanges,
			};
			console.log("Dialogue module initialized with new string-based logic and autocomplete.");
		} catch (error) {
			console.error('Dialogue Initialization failed:', error);
			alert(`Failed to initialize the Dialogue editor.\n\nError: ${error.message}`);
		}
	};
    
    initializeEditor();
});
