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