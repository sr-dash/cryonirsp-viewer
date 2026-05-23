/* =========================================================
   GLOBAL DELEGATION FOR FILTERS 
========================================================= */

// 1. Handle Text Search (with Debouncing to prevent freezing)
let searchTimeout; // Define timer variable outside the event

document.addEventListener('input', (e) => {
    if (e.target && e.target.id === 'searchBox') {
        const val = e.target.value;

        // Clear the previous timer on every keystroke
        clearTimeout(searchTimeout);

        // Wait 300ms after the user stops typing before running heavy tasks
        searchTimeout = setTimeout(() => {
            renderTree();

            if (val.trim() === '') {
                activeDataset = null;
                renderLandingOverview();
            }
        }, 300);
    }
});

// 2. Handle Dropdowns (Change event)
document.addEventListener('change', (e) => {
    if (e.target && (e.target.id === 'typeFilter' || e.target.id === 'sortMode')) {
        renderTree();
        activeDataset = null;
        renderLandingOverview();
    }
});

/* =========================================================
   MOBILE MENU TOGGLE & AUTO-CLOSE
========================================================= */
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

    // Event Delegation: Close menu when a dataset item is clicked
    document.addEventListener('click', (e) => {
        const datasetItem = e.target.closest('.dataset-item');
        
        if (datasetItem && window.innerWidth <= 1000) {
            // Delay closing the sidebar by 200ms to allow the click to register!
            setTimeout(() => {
                body.classList.remove('sidebar-open');
            }, 200);
        }
    });
});