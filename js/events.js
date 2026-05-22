document.getElementById('searchBox')
    .addEventListener('input',()=>{

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
    .addEventListener('change',()=>{

        renderTree();

        activeDataset = null;

        renderLandingOverview();
    });

document.getElementById('sortMode')
    .addEventListener('change',()=>{

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

    /* =========================================================
       EVENT DELEGATION: Auto-close sidebar on mobile
    ========================================================= */

    document.addEventListener('click', (e) => {
        // Only close when a final dataset selection is made
        const isDataset = e.target.closest('.dataset-item');
        
        if (isDataset && window.innerWidth <= 1000) {
            body.classList.remove('sidebar-open');
        }
    });

    // NOTE: We intentionally do NOT close the sidebar on search input (keydown)
    // or sorting (change) so the user can see the updated list in the sidebar.
});