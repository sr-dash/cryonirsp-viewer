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

    // Toggle menu
    menuBtn.addEventListener('click', () => {
        body.classList.toggle('sidebar-open');
    });

    // Close menu when clicking the overlay
    overlay.addEventListener('click', () => {
        body.classList.remove('sidebar-open');
    });

    // Optional: Close menu when a dataset is selected (for better UX)
    const datasetItems = document.querySelectorAll('.dataset-item');
    datasetItems.forEach(item => {
        item.addEventListener('click', () => {
            if (window.innerWidth <= 1000) {
                body.classList.remove('sidebar-open');
            }
        });
    });
});