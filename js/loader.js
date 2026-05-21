async function loadArchive(){

    try{

        const response =
            await fetch(
                'data/cryonirsp_dataset_details.json'
            );

        window.archiveLastModified = response.headers.get('Last-Modified');

        const data = await response.json();

        datasetDB = data.datasets || data;

        updateStats();

        initializeStatFilters();

        renderTree();

        renderLandingOverview();

    }catch(err){

        console.error(err);

        document.getElementById('detailsPanel').innerHTML = `
            <div class="placeholder">
                Failed to load dataset JSON
            </div>
        `;
    }
}