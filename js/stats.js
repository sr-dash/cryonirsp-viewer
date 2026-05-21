// =====================================================
// STATS
// =====================================================

function updateStats(){

    const arr = Object.values(datasetDB);

    const nPolarimetric =
        arr.filter(d=>d.dataset_type === 'polarimetric').length;

    const nSpectrometric =
        arr.filter(d=>d.dataset_type === 'spectrometric').length;

    const nContext =
        arr.filter(d=>d.is_context_imager).length;

    document.getElementById('nDatasets').innerText =
        arr.length;

    document.getElementById('nPolarimetric').innerText =
        nPolarimetric;

    document.getElementById('nSpectrometric').innerText =
        nSpectrometric;

    document.getElementById('nContext').innerText =
        nContext;
}

function initializeStatFilters(){

    document.querySelectorAll('.clickable-stat')
        .forEach(stat=>{

            stat.onclick = ()=>{

                const filter =
                    stat.dataset.filter;

                document.getElementById('typeFilter').value =
                    filter;

                document.querySelectorAll('.clickable-stat')
                    .forEach(x=>x.classList.remove('active'));

                stat.classList.add('active');

                renderTree();

                if(!activeDataset){
                    renderLandingOverview();
                }
            };
        });
}
