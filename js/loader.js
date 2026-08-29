const INVENTORY_URL = 'data/cryonirsp_dataset_details.json';

async function loadArchive(){

    try{

        const response =
            await fetch(INVENTORY_URL);

        if(!response.ok)
            throw new Error(`${response.status} ${response.statusText}`);

        const headerModified =
            response.headers.get('Last-Modified');

        const payload = await response.json();

        // Everything downstream reads the adapted shape.
        const { datasets, meta, aliases } =
            adaptInventory(payload);

        datasetDB = datasets;

        archiveMeta = meta;

        // Superseded dataset IDs -> the product that replaced them.
        datasetAliases = aliases;

        // The inventory's own build time is authoritative.
        // The HTTP header only tracks deploys, so it is a
        // fallback for the legacy file that carries no
        // generated_at.
        window.archiveLastModified =
            meta.generated_at || headerModified;

        updateStats();

        initializeStatFilters();

        renderTree();

        openRequestedDataset() || renderLandingOverview();

    }catch(err){

        console.error(err);

        document.getElementById('detailsPanel').innerHTML = `
            <div class="placeholder">
                Failed to load the dataset inventory.<br>
                <span style="font-size:12px;opacity:0.7;">
                    ${INVENTORY_URL} &mdash; see the browser console for details.
                </span>
            </div>
        `;
    }
}


// =====================================================
// DEEP LINK
//
// ?dataset=SMPJNK, ?dataset=PQLYUM (superseded) or
// ?product=L1-AFCUG all open the same record.
// =====================================================

function openRequestedDataset(){

    const params = new URLSearchParams(window.location.search);

    const requested =
        params.get('dataset') ||
        params.get('product') ||
        window.location.hash.replace('#', '');

    if(!requested)
        return false;

    const record = resolveDataset(requested);

    if(!record){

        console.warn(`No dataset matches ${requested}`);
        return false;
    }

    activeDataset = record;

    enterArchive();

    renderDatasetDetails();

    return true;
}
