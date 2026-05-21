// =====================================================
// TREE
// =====================================================

function renderTree(){

    const tree = document.getElementById('tree');

    tree.innerHTML = '';

    const search = document.getElementById('searchBox').value.toLowerCase().trim();

    SEARCH_ACTIVE = search.length > 0;

    const typeFilter = document.getElementById('typeFilter').value;

    // =====================================================
    // NEW HIERARCHICAL GROUPING
    // observingProgramExecutionId
    //      -> product_id
    //              -> datasets
    // =====================================================

    const grouped = {};

    Object.values(datasetDB).forEach(d=>{

        const dateText = d.start_time
            ? new Date(d.start_time).toISOString().slice(0,10)
            : '';

        const inactiveIDs = Array.isArray(d.inactive_dataset_ids)
            ? d.inactive_dataset_ids.join(' ')
            : (d.inactive_dataset_ids || '');

        const text = (
            (d.observingProgramExecutionId || '') + ' ' +
            (d.collection_id || '') + ' ' +
            (d.product_id || '') + ' ' +
            (d.dataset_id || '') + ' ' +
            inactiveIDs + ' ' +
            (d.waveband || '') + ' ' +
            (d.object || '') + ' ' +
            dateText
        ).toLowerCase();

        if(search && !text.includes(search))
            return;

        if(typeFilter !== 'all'){

                        if(typeFilter === 'context_imager'){

                            if(!d.is_context_imager)
                                return;

                        }else{

                            if(d.dataset_type !== typeFilter)
                                return;
                        }
                    }

        const observingProgram =
            d.observingProgramExecutionId || 'UNKNOWN_PROGRAM';

        const product =
            d.product_id || 'UNKNOWN_PRODUCT';

        if(!grouped[observingProgram])
            grouped[observingProgram] = {};

        if(!grouped[observingProgram][product])
            grouped[observingProgram][product] = [];

        grouped[observingProgram][product].push(d);
    });

    const programKeys = Object.keys(grouped).sort();

    programKeys.forEach(program=>{

        const collectionDiv = document.createElement('div');

        collectionDiv.className = 'collection';

        const allDatasets =
            Object.values(grouped[program]).flat();

        collectionDiv.innerHTML = `

            <div class="collection-header">

                <div>

                    <div class="collection-title mono">
                        ${program}
                    </div>

                    <div style="
                        font-size:10px;
                        color:var(--muted);
                        margin-top:4px;
                    ">
                        ${allDatasets.length} datasets
                    </div>

                </div>

                <div style="
                    font-size:12px;
                    color:var(--accent2);
                ">
                    ${Object.keys(grouped[program]).length}
                </div>

            </div>

            <div class="collection-body"></div>
        `;

        const header =
            collectionDiv.querySelector('.collection-header');

        const body =
            collectionDiv.querySelector('.collection-body');

        body.style.display =
            SEARCH_ACTIVE ? 'block' : 'none';

        header.onclick = ()=>{

            body.style.display =
                body.style.display === 'block'
                ? 'none'
                : 'block';
        };

        const productKeys =
            Object.keys(grouped[program]).sort();

        productKeys.forEach(product=>{

            const datasets =
                grouped[program][product];

            const productDiv =
                document.createElement('div');

            productDiv.className = 'product';

            productDiv.innerHTML = `

                <div class="product-header">

                    <div>

                        <div class="product-title mono">
                            ${product}
                        </div>

                        <div style="
                            font-size:10px;
                            color:var(--muted);
                            margin-top:4px;
                        ">
                            ${datasets[0]?.waveband || 'Unknown'}
                        </div>

                    </div>

                    <div style="
                        font-size:12px;
                        color:var(--accent2);
                    ">
                        ${datasets.length}
                    </div>

                </div>

                <div class="product-body"></div>
            `;

            const pHeader =
                productDiv.querySelector('.product-header');

            const pBody =
                productDiv.querySelector('.product-body');

            pBody.style.display =
                SEARCH_ACTIVE ? 'block' : 'none';

            pHeader.onclick = ()=>{

                pBody.style.display =
                    pBody.style.display === 'block'
                    ? 'none'
                    : 'block';
            };

            datasets.sort((a,b)=>{

                const ta =
                    a.start_time
                    ? new Date(a.start_time).getTime()
                    : 0;

                const tb =
                    b.start_time
                    ? new Date(b.start_time).getTime()
                    : 0;

                return tb - ta;
            });

            const renderCount =
                Math.min(DATASET_RENDER_LIMIT,datasets.length);

            for(let i=0;i<renderCount;i++){

                const d = datasets[i];

                const item =
                    document.createElement('div');

                item.className = 'dataset-item';

                item.innerHTML = `

                    <div class="dataset-id">
                        ${d.dataset_id || 'UNKNOWN_DATASET'}
                    </div>

                    <div class="dataset-meta">

                        <div>
                            ${d.start_time
                                ? d.start_time.slice(0,10)
                                : 'Unknown'}
                        </div>

                        <div>
                            ${d.waveband || 'N/A'}
                        </div>

                        <div>
                            ${d.dataset_type || ''}
                        </div>

                    </div>
                `;

                item.onclick = ()=>{

                    document.querySelectorAll('.dataset-item')
                        .forEach(x=>x.classList.remove('active'));

                    item.classList.add('active');

                    activeDataset = d;

                    renderDatasetDetails();
                };

                pBody.appendChild(item);
            }

            if(datasets.length > DATASET_RENDER_LIMIT){

                const more = document.createElement('div');

                more.style.padding = '10px';
                more.style.fontSize = '11px';
                more.style.color = 'var(--muted)';
                more.style.textAlign = 'center';

                more.innerText =
                    `Showing ${DATASET_RENDER_LIMIT} of ${datasets.length} datasets`;

                pBody.appendChild(more);
            }

            body.appendChild(productDiv);
        });

        tree.appendChild(collectionDiv);
    });
}