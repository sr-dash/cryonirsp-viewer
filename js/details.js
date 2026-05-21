// =====================================================
// DETAILS
// =====================================================

function renderDatasetDetails(){

    if(!activeDataset) return;

    const d = activeDataset;

    const contextImagePath = d.context_image
        ? `cn_daily_context_figures/${d.context_image}`
        : null;

    const MEDIA_BASE =
        'https://github.com/sr-dash/cryonirsp-media/releases/download/media-v1/';

    function mediaURL(filename) {
        return filename ? MEDIA_BASE + filename : null;
    }

    const contextMoviePath =
    mediaURL(d.context_movie);

    const contextMovieThumbnail =
        mediaURL(d.context_movie_thumbnail);

    const panel = document.getElementById('detailsPanel');

    panel.innerHTML = `

        <div class="hero">

            <!-- ================================================= -->
            <!-- DATASET HEADER SECTION -->
            <!-- ================================================= -->

            <div class="section dataset-header-section">

                <!-- Header top -->
                <div class="dataset-header-top">

                    <div>

                        <div class="dataset-name">
                            ${d.dataset_id || 'UNKNOWN_DATASET'}
                        </div>

                        <div class="hero-sub">

                            <div class="badge ${d.dataset_type}">
                                ${d.dataset_type || 'unknown'}
                            </div>

                            ${d.is_context_imager
                                ? `
                                    <div class="badge context">
                                        Context Imager
                                    </div>
                                `
                                : ''}

                        </div>

                    </div>

                </div>

                <!-- Quick summary -->
                <div class="cards compact-cards">

                    <div class="card">

                        <div class="card-label">
                            Waveband
                        </div>

                        <div class="card-value mono">
                            ${d.waveband || 'N/A'}
                        </div>

                    </div>

                    <div class="card">

                        <div class="card-label">
                            Central Wavelength
                        </div>

                        <div class="card-value mono">
                            ${d.line_wave || 'N/A'} nm
                        </div>

                    </div>

                    <div class="card">

                        <div class="card-label">
                            Duration
                        </div>

                        <div class="card-value mono">
                            ${d.duration || 'N/A'}
                        </div>

                    </div>

                    <div class="card">

                        <div class="card-label">
                            Dataset Shape
                        </div>

                        <div class="card-value mono">
                            ${d.dataset_shape_str || 'N/A'}
                        </div>

                    </div>

                </div>

            </div>

            <!-- ================================================= -->
            <!-- OBSERVATION + INSTRUMENT -->
            <!-- ================================================= -->

            <div class="grid2 section-grid">

                <!-- ============================================= -->
                <!-- OBSERVATION INFORMATION -->
                <!-- ============================================= -->

                <div class="section">

                    <div class="section-title">
                        Observation Information
                    </div>

                    <div class="cards compact-cards">

                        <div class="card">

                            <div class="card-label">
                                Start Time
                            </div>

                            <div class="card-value mono">

                                ${d.start_time ? (() => {

                                    const t = new Date(d.start_time);

                                    const doy = Math.floor(
                                        (
                                            t -
                                            new Date(
                                                Date.UTC(
                                                    t.getUTCFullYear(),
                                                    0,
                                                    0
                                                )
                                            )
                                        ) / 86400000
                                    );

                                    return `
                                        ${t.getUTCFullYear()}-${String(doy).padStart(3,'0')}
                                        ${t.toISOString().slice(11,19)} UTC
                                    `;

                                })() : 'N/A'}

                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                End Time
                            </div>

                            <div class="card-value mono">

                                ${d.end_time ? (() => {

                                    const t = new Date(d.end_time);

                                    const doy = Math.floor(
                                        (
                                            t -
                                            new Date(
                                                Date.UTC(
                                                    t.getUTCFullYear(),
                                                    0,
                                                    0
                                                )
                                            )
                                        ) / 86400000
                                    );

                                    return `
                                        ${t.getUTCFullYear()}-${String(doy).padStart(3,'0')}
                                        ${t.toISOString().slice(11,19)} UTC
                                    `;

                                })() : 'N/A'}

                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Scan Steps
                            </div>

                            <div class="card-value mono">
                                ${d.n_scanSteps || 'N/A'}
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Measurements / Step
                            </div>

                            <div class="card-value mono">
                                ${d.n_measAtStep || 'N/A'}
                            </div>

                        </div>

                    </div>

                </div>

                <!-- ============================================= -->
                <!-- INSTRUMENT INFORMATION -->
                <!-- ============================================= -->

                <div class="section">

                    <div class="section-title">
                        Instrument & Scan Information
                    </div>

                    <div class="cards compact-cards">

                        <div class="card">

                            <div class="card-label">
                                Instrument
                            </div>

                            <div class="card-value mono">
                                ${d.instrument_name || d.instrument || 'N/A'}
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Observatory
                            </div>

                            <div class="card-value mono">
                                ${d.observatory || 'N/A'}
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Observer
                            </div>

                            <div class="card-value mono">
                                ${d.observer || 'N/A'}
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Target Object
                            </div>

                            <div class="card-value mono">
                                ${d.object || 'N/A'}
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Scan Step Width
                            </div>

                            <div class="card-value mono">
                                ${
                                    d.stepWidth_arcsec != null
                                    ? d.stepWidth_arcsec.toFixed(4)
                                    : 'N/A'
                                }
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Slit Sampling
                            </div>

                            <div class="card-value mono">
                                ${
                                    d.slitSampling_arcsec != null
                                    ? d.slitSampling_arcsec.toFixed(4)
                                    : 'N/A'
                                }
                            </div>

                        </div>

                    </div>

                </div>

            </div>

            <!-- ================================================= -->
            <!-- CONTEXT MEDIA -->
            <!-- ================================================= -->

            ${(contextImagePath || contextMoviePath) ? `

            <div class="section">

                <div class="section-title">
                    Context Media
                </div>

                <div class="context-grid">

                    ${contextImagePath ? `

                    <div class="context-media-card">

                        <div class="context-media-header">
                            Daily Context Image
                        </div>

                        <div class="context-media-content">

                            <a
                                href="${contextImagePath}"
                                target="_blank"
                            >

                                <img
                                    src="${contextImagePath}"
                                    loading="lazy"
                                >

                            </a>

                            <div class="context-caption">
                                ${d.context_image || ''}
                            </div>

                        </div>

                    </div>

                    ` : ''}

                    ${contextMoviePath ? `

                    <div class="context-media-card">

                        <div class="context-media-header">
                            Daily Context Movie
                        </div>

                        <div class="context-media-content">

                            <video
                                controls
                                preload="metadata"
                                poster="${contextMovieThumbnail || ''}"
                            >

                                <source
                                    src="${contextMoviePath}"
                                    type="video/mp4"
                                >

                            </video>

                            <div class="context-caption">
                                ${d.context_movie || ''}
                            </div>

                        </div>

                    </div>

                    ` : ''}

                </div>

            </div>

            ` : ''}

            <!-- ================================================= -->
            <!-- SOLAR FOOTPRINT -->
            <!-- ================================================= -->

            <div class="section">

                <div class="section-title">
                    Solar Footprint & Spatial Bounds
                </div>

                <div class="grid2">

                    <!-- ========================================= -->
                    <!-- SVG FOOTPRINT -->
                    <!-- ========================================= -->

                    <div class="card">

                        <div class="card-label">
                            Solar Disk Footprint
                        </div>

                        ${makeSolarFootprint(d)}

                    </div>

                    <!-- ========================================= -->
                    <!-- COORDINATES -->
                    <!-- ========================================= -->

                    <div>

                        <div class="cards">

                            <div class="card">

                                <div class="card-label">
                                    Solar Radius
                                </div>

                                <div class="card-value mono">

                                    ${
                                        d.solar_radius_arcsec != null
                                        ? d.solar_radius_arcsec.toFixed(2)
                                        : 'N/A'
                                    } arcsec

                                </div>

                            </div>

                        </div>

                        <div class="card" style="margin-top:16px;">

                            <div class="card-label">
                                Spatial Polygon Coordinates
                            </div>

                            <div style="
                                display:grid;
                                grid-template-columns:1fr 1fr;
                                gap:18px;
                                margin-top:14px;
                            ">

                                <!-- X -->

                                <div>

                                    <div style="
                                        font-size:11px;
                                        color:var(--muted);
                                        margin-bottom:10px;
                                        text-transform:uppercase;
                                        letter-spacing:0.7px;
                                    ">
                                        Solar X [arcsec]
                                    </div>

                                    <div style="
                                        display:flex;
                                        flex-direction:column;
                                        gap:6px;
                                    ">

                                        ${d.spatial_bounds_arcsec?.[0]
                                            ? d.spatial_bounds_arcsec[0].map(v=>`

                                                <div style="
                                                    font-family:'JetBrains Mono',monospace;
                                                    font-size:13px;
                                                    padding:8px 10px;
                                                    border-radius:10px;
                                                    background:rgba(255,255,255,0.04);
                                                ">
                                                    ${Number(v).toFixed(2)}
                                                </div>

                                            `).join('')
                                            : 'N/A'}

                                    </div>

                                </div>

                                <!-- Y -->

                                <div>

                                    <div style="
                                        font-size:11px;
                                        color:var(--muted);
                                        margin-bottom:10px;
                                        text-transform:uppercase;
                                        letter-spacing:0.7px;
                                    ">
                                        Solar Y [arcsec]
                                    </div>

                                    <div style="
                                        display:flex;
                                        flex-direction:column;
                                        gap:6px;
                                    ">

                                        ${d.spatial_bounds_arcsec?.[1]
                                            ? d.spatial_bounds_arcsec[1].map(v=>`

                                                <div style="
                                                    font-family:'JetBrains Mono',monospace;
                                                    font-size:13px;
                                                    padding:8px 10px;
                                                    border-radius:10px;
                                                    background:rgba(255,255,255,0.04);
                                                ">
                                                    ${Number(v).toFixed(2)}
                                                </div>

                                            `).join('')
                                            : 'N/A'}

                                    </div>

                                </div>

                            </div>

                        </div>

                    </div>

                </div>

            </div>

            <!-- ================================================= -->
            <!-- METADATA -->
            <!-- ================================================= -->

            <div class="section">

                <div class="section-title">
                    Metadata & Archive Information
                </div>

                <div class="cards">

                    <div class="card">

                        <div class="card-label">
                            Collection ID
                        </div>

                        <div class="card-value mono">
                            ${d.collection_id || 'N/A'}
                        </div>

                    </div>

                    <div class="card">

                        <div class="card-label">
                            Product ID
                        </div>

                        <div class="card-value mono">

                            ${d.product_id
                                ? `
                                    <a
                                        href="https://dkist.data.nso.edu/product/${d.product_id}"
                                        target="_blank"
                                        style="
                                            color:var(--accent2);
                                            text-decoration:none;
                                            word-break:break-word;
                                        "
                                    >
                                        ${d.product_id}
                                    </a>
                                `
                                : 'N/A'}

                        </div>

                    </div>

                    <div class="card">

                        <div class="card-label">
                            Archived / Inactive Dataset IDs
                        </div>

                        <div class="card-value mono">

                            ${
                                d.inactive_dataset_ids &&
                                d.inactive_dataset_ids !== 'nan' &&
                                (
                                    Array.isArray(d.inactive_dataset_ids)
                                        ? d.inactive_dataset_ids.length > 0
                                        : true
                                )

                                ? (

                                    Array.isArray(d.inactive_dataset_ids)

                                        ? d.inactive_dataset_ids.map(id => `

                                            <div style="
                                                margin-bottom:8px;
                                                padding:8px 10px;
                                                border-radius:10px;
                                                background:rgba(255,255,255,0.04);
                                                border:1px solid rgba(255,255,255,0.05);
                                                word-break:break-word;
                                            ">
                                                ${id}
                                            </div>

                                        `).join('')

                                        : `
                                            <div style="
                                                padding:8px 10px;
                                                border-radius:10px;
                                                background:rgba(255,255,255,0.04);
                                                border:1px solid rgba(255,255,255,0.05);
                                                word-break:break-word;
                                            ">
                                                ${d.inactive_dataset_ids}
                                            </div>
                                        `
                                )

                                : 'None'
                            }

                        </div>

                    </div>

                    <div class="card">

                        <div class="card-label">
                            Metadata File
                        </div>

                        <div class="card-value mono">

                            ${
                                d.metadata_file
                                ? d.metadata_file.split('/').pop()
                                : 'N/A'
                            }

                        </div>

                    </div>

                </div>

            </div>

        </div>
    `;
}