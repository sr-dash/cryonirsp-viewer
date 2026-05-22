/* =========================================================
   GLOBAL DELEGATION FOR FILTERS 
   (Fixes mobile listeners and duplicate ID issues)
========================================================= */

// 1. Handle Text Search (Input event)
document.addEventListener('input', (e) => {
    // Check if the element the user typed in has the ID 'searchBox'
    if (e.target && e.target.id === 'searchBox') {
        
        // Mobile UX Fix: Save cursor position in case renderTree steals focus
        const selectionStart = e.target.selectionStart; 
        const val = e.target.value;

        renderTree();

        if (val.trim() === '') {
            activeDataset = null;
            renderLandingOverview();
        }

        // Restore focus to the mobile keyboard so it doesn't close while typing
        const freshInput = document.getElementById('searchBox');
        if (freshInput) {
            freshInput.focus();
            freshInput.value = val;
            freshInput.setSelectionRange(selectionStart, selectionStart);
        }
    }
});

// 2. Handle Dropdowns (Change event)
document.addEventListener('change', (e) => {
    // Check if the element the user changed is one of our filters
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
        
        // Only close the sidebar if they clicked an actual dataset to view it
        if (datasetItem && window.innerWidth <= 1000) {
            body.classList.remove('sidebar-open');
        }
    });
});