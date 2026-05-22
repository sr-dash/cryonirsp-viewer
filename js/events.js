document.getElementById('searchBox')
    .addEventListener('input',(e)=>{

        renderTree();

        if(
            document.getElementById('searchBox')
                .value.trim() === ''
        ){

            activeDataset = null;

            renderLandingOverview();
        }
    });

document.getElementById('typeFilter')
    .addEventListener('change',(e)=>{

        renderTree();

        activeDataset = null;

        renderLandingOverview();
    });

document.getElementById('sortMode')
    .addEventListener('change',(e)=>{

        renderTree();

        activeDataset = null;

        renderLandingOverview();
    });

document.addEventListener('DOMContentLoaded', () => {
    const menuBtn = document.getElementById('mobileMenuBtn');
    const overlay = document.getElementById('sidebarOverlay');
    const body = document.body;

    // Toggle menu open/close
    if (menuBtn) {
        menuBtn.addEventListener('click', () => {
            body.classList.toggle('sidebar-open');
        });
    }

    // Close menu when clicking the darkened overlay
    if (overlay) {
        overlay.addEventListener('click', () => {
            body.classList.remove('sidebar-open');
        });
    }

    // Event Delegation: Close menu when ANY dataset item is clicked
    document.addEventListener('click', (e) => {
        // Check if the click target or its parent is a dataset item
        const datasetItem = e.target.closest('.dataset-item');
        
        if (datasetItem && window.innerWidth <= 1000) {
            body.classList.remove('sidebar-open');
        }
    });
});