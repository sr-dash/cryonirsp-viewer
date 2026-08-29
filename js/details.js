// =====================================================
// DETAILS
// =====================================================

function renderDatasetDetails(){

    if(!activeDataset) return;

    const d = activeDataset;

    // Media locations are resolved once, in js/adapt.js.
    const contextImagePath = d.context_image_url;

    const contextMoviePath = d.context_movie_url;

    const contextMovieThumbnail = d.context_movie_poster_url;

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
                            ${esc(d.dataset_id || 'UNKNOWN_DATASET')}
                        </div>

                        <div class="hero-sub">

                            <div class="badge ${typeClass(d.dataset_type)}">
                                ${esc(d.dataset_type || 'unknown')}
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
                            ${esc(d.waveband || 'N/A')}
                        </div>

                    </div>

                    <div class="card">

                        <div class="card-label">
                            Central Wavelength
                        </div>

                        <div class="card-value mono">
                            ${esc(d.line_wave || 'N/A')} nm
                        </div>

                    </div>

                    <div class="card">

                        <div class="card-label">
                            Duration
                        </div>

                        <div class="card-value mono">
                            ${esc(d.duration || 'N/A')}
                        </div>

                    </div>

                    <div class="card">

                        <div class="card-label">
                            Dataset Shape
                        </div>

                        <div class="card-value mono">
                            ${esc(d.dataset_shape_str || 'N/A')}
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

                                ${utcStamp(d.start_time)}
                                ${d.start_time ? `<span style="
                                    color:var(--muted);
                                    font-size:11px;
                                    margin-left:6px;
                                ">DOY ${dayOfYear(d.start_time)}</span>` : ''}

                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                End Time
                            </div>

                            <div class="card-value mono">

                                ${utcStamp(d.end_time)}
                                ${d.end_time ? `<span style="
                                    color:var(--muted);
                                    font-size:11px;
                                    margin-left:6px;
                                ">DOY ${dayOfYear(d.end_time)}</span>` : ''}

                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Scan Steps
                            </div>

                            <div class="card-value mono">
                                ${esc(d.n_scanSteps ?? 'N/A')}
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Measurements / Step
                            </div>

                            <div class="card-value mono">
                                ${esc(d.n_measAtStep ?? 'N/A')}
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
                                ${esc(d.instrument_name || d.instrument || 'N/A')}
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Observatory
                            </div>

                            <div class="card-value mono">
                                ${esc(d.observatory || 'N/A')}
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Observer
                            </div>

                            <div class="card-value mono">
                                ${esc(d.observer || 'N/A')}
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Target Object
                            </div>

                            <div class="card-value mono">
                                ${esc(d.object || 'N/A')}
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Scan Step Width
                            </div>

                            <div class="card-value mono">
                                ${fixed(d.stepWidth_arcsec, 4)}
                            </div>

                        </div>

                        <div class="card">

                            <div class="card-label">
                                Slit Sampling
                            </div>

                            <div class="card-value mono">
                                ${fixed(d.slitSampling_arcsec, 4)}
                            </div>

                        </div>

                    </div>

                </div>

            </div>

            <!-- ================================================= -->
            <!-- OBSERVING PROGRAM -->
            <!-- ================================================= -->

            <div class="section">

                <div class="section-title">
                    Observing Program
                </div>

                <div class="cards compact-cards">

                    <div class="card">
                        <div class="card-label">Experiment</div>
                        <div class="card-value mono">${esc(d.experiment_id || 'N/A')}</div>
                    </div>

                    <div class="card">
                        <div class="card-label">Proposal</div>
                        <div class="card-value mono">${esc(d.proposal_id || 'N/A')}</div>
                    </div>

                    <div class="card">
                        <div class="card-label">Observing Mode</div>
                        <div class="card-value mono">${esc(d.observing_mode || 'N/A')}</div>
                    </div>

                    <div class="card">
                        <div class="card-label">Arm / Stokes</div>
                        <div class="card-value mono">
                            ${esc(d.arm || '?')} &middot; ${esc(d.stokes_parameters || '?')}
                        </div>
                    </div>

                </div>

                ${d.experiment_description ? `

                    <div class="card" style="margin-top:16px;">

                        <div class="card-label">
                            Experiment Description
                        </div>

                        <div style="
                            margin-top:10px;
                            font-size:13px;
                            line-height:1.6;
                            color:var(--muted);
                            max-height:190px;
                            overflow-y:auto;
                        ">
                            ${esc(d.experiment_description)}
                        </div>

                    </div>

                ` : ''}

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
                                href="${escURL(contextImagePath)}"
                                target="_blank"
                            >

                                <img
                                    src="${escURL(contextImagePath)}"
                                    loading="lazy"
                                >

                            </a>

                            <div class="context-caption">
                                ${esc(d.context_image || '')}
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
                                poster="${escURL(contextMovieThumbnail)}"
                            >

                                <source
                                    src="${escURL(contextMoviePath)}"
                                    type="video/mp4"
                                >

                            </video>

                            <div class="context-caption">
                                ${esc(d.context_movie || '')}
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

                        <div class="cards compact-cards">

                            <div class="card">

                                <div class="card-label">
                                    Radial Distance
                                </div>

                                <div class="card-value mono">
                                    ${fixed(d.radial_distance, 3, ' R\u2609')}
                                </div>

                            </div>

                            <div class="card">

                                <div class="card-label">
                                    Position Angle
                                </div>

                                <div class="card-value mono">
                                    ${fixed(d.position_angle_deg, 1, '\u00b0')}
                                </div>

                            </div>

                            <div class="card">

                                <div class="card-label">
                                    Solar Radius
                                </div>

                                <div class="card-value mono">

                                    ${fixed(d.solar_radius_arcsec, 2, ' arcsec')}

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
                            ${esc(d.collection_id || 'N/A')}
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
                                        href="https://dkist.data.nso.edu/product/${encodeURIComponent(d.product_id)}"
                                        target="_blank"
                                        style="
                                            color:var(--accent2);
                                            text-decoration:none;
                                            word-break:break-word;
                                        "
                                    >
                                        ${esc(d.product_id)}
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
                                                display:flex;
                                                justify-content:space-between;
                                                gap:10px;
                                            ">
                                                <span>${esc(id)}</span>
                                                <span style="
                                                    font-size:10px;
                                                    letter-spacing:0.6px;
                                                    color:var(--muted);
                                                    align-self:center;
                                                ">
                                                    ${esc((d.archived_status || {})[id] || '')}
                                                </span>
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
                                                ${esc(d.inactive_dataset_ids)}
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

                            ${esc(d.metadata_file || 'N/A')}

                        </div>

                    </div>

                    <div class="card">

                        <div class="card-label">
                            Calibration
                        </div>

                        <div class="card-value mono">
                            ${esc(d.calibration_workflow_version || 'N/A')}
                            ${d.dataset_status
                                ? `<span style="color:var(--muted);font-size:11px;">
                                       &middot; ${esc(d.dataset_status)}
                                   </span>`
                                : ''}
                        </div>

                    </div>

                    <div class="card">

                        <div class="card-label">
                            Size / Frames
                        </div>

                        <div class="card-value mono">
                            ${fixed(d.dataset_size_gib, 2, ' GiB')}
                            <span style="color:var(--muted);font-size:11px;">
                                &middot; ${esc(d.number_of_frames ?? '?')} frames
                            </span>
                        </div>

                    </div>

                    ${d.preview_url ? `

                    <div class="card">

                        <div class="card-label">
                            Data Center
                        </div>

                        <div class="card-value mono">
                            <a
                                href="${escURL(d.preview_url)}"
                                target="_blank"
                                rel="noopener noreferrer"
                                style="color:var(--accent2);text-decoration:none;"
                            >
                                Preview movie
                            </a>
                        </div>

                    </div>

                    ` : ''}

                </div>

            </div>

        </div>
    `;
}