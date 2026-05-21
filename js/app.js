loadArchive();

// =====================================
// LANDING PAGE LINK
// =====================================

document.getElementById('homeLink')
    .addEventListener('click',(e)=>{

        e.preventDefault();

        activeDataset = null;

        // remove highlighted dataset
        document.querySelectorAll('.dataset-item')
            .forEach(x=>x.classList.remove('active'));

        // clear filters/search optionally
        // document.getElementById('searchBox').value = '';

        renderLandingOverview();
    });


// ============================================
// ENTER ARCHIVE MODE
// ============================================

function enterArchive(){

    document.body.classList.remove('landing-mode');

    setTimeout(()=>{

        const tree =
            document.getElementById('tree');

        if(tree){

            tree.scrollTop = 0;
        }

    },300);
}