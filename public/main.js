// --- GLOBAL APP NAMESPACE ---
window.App = {
    // Modules will register themselves here, e.g., window.App.Items, window.App.Npcs
};

document.addEventListener('DOMContentLoaded', () => {
    // --- TAB SWITCHING LOGIC ---
    const tabs = document.querySelectorAll('.tab-button');
    const tabContents = document.querySelectorAll('.tab-content');

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));

            tab.classList.add('active');
            document.getElementById(tab.dataset.tab).classList.add('active');
        });
    });

    // --- GLOBAL DATA MANAGEMENT ---
    const saveAllBtn = document.getElementById('save-all-btn');
    let unsavedChanges = false;

    const DataManager = {
        setUnsavedChanges: (hasChanges) => {
            if (hasChanges && !unsavedChanges) {
                unsavedChanges = true;
                updateSaveButtonState();
            }
        },

        saveAll: async () => {
            if (!unsavedChanges) {
                alert("No changes to save.");
                return;
            }

            console.log("Attempting to save all changes...");
            const savePromises = [];

            // Find all registered modules in the App namespace and call their save method
            for (const moduleName in window.App) {
                const module = window.App[moduleName];
                if (typeof module.save === 'function' && typeof module.hasUnsavedChanges === 'function') {
                    if (module.hasUnsavedChanges()) {
                        console.log(`Saving module: ${moduleName}`);
                        savePromises.push(module.save());
                    }
                }
            }

            try {
                await Promise.all(savePromises);
                unsavedChanges = false;
                updateSaveButtonState();
                alert('All data saved successfully!');
            } catch (error) {
                console.error('Error saving data:', error);
                alert(`Could not save all data.\n\nError: ${error.message}`);
            }
        }
    };

    const updateSaveButtonState = () => {
        if (unsavedChanges) {
            saveAllBtn.textContent = 'Save All Changes *';
            saveAllBtn.classList.add('button-success');
        } else {
            saveAllBtn.textContent = 'All Changes Saved';
            saveAllBtn.classList.remove('button-success');
        }
    };

    // Expose the DataManager to the global App namespace
    window.App.DataManager = DataManager;

    // Initialize button state and event listener
    updateSaveButtonState();
    saveAllBtn.addEventListener('click', DataManager.saveAll);
});