// =====================================================
// INVENTORY ADAPTER
//
// The single point of contact between the inventory file
// and the rest of the site.
//
// Everything downstream (tree.js, stats.js, details.js,
// solar.js) reads the shape this file produces, never the
// raw JSON. When the inventory schema changes, this is the
// only file that should need editing.
//
// Contract: data/SCHEMA.md
// =====================================================


// -----------------------------------------------------
// MEDIA RESOLUTION
//
// The inventory ships bare filenames; the locations live
// here. Changing where media is hosted is a one-line edit
// in this block and nowhere else.
// -----------------------------------------------------

// Both context figures and movies are served from one GitHub release on
// sr-dash/cryonirsp-media. Nothing media-related is committed to this repo:
// the figures alone grow ~8 MB a year and git would keep every regenerated
// version forever. The NSO share directory is the upstream source, not the
// serving host — it is not reliably available.
//
// THE TAG IS A MAINTENANCE OBLIGATION. A tag that does not contain a given
// date's file renders a broken image or an empty player with no error —
// which is exactly what media-v1 does now, since it predates every 2026
// date. When media is added, re-cut and bump RELEASE_TAG:
//
//   gh release create media-vN \
//       cn_daily_context_figures/*.jpg cn_daily_movies/* \
//       --repo sr-dash/cryonirsp-media \
//       --title "Cryo-NIRSP daily context media"
//
// The three filename families never collide:
//   daily_context_YYYYMMDD.jpg      context figure
//   cn_daily_movie_YYYYMMDD.mp4     movie
//   cn_daily_movie_YYYYMMDD.jpg     movie poster
//
// tools/validate_inventory.py checks the published inventory against the
// release's actual asset list in CI.

const RELEASE_TAG = 'media-v2';

const RELEASE_BASE =
    `https://github.com/sr-dash/cryonirsp-media/releases/download/${RELEASE_TAG}/`;

const MEDIA = {
    imageBase: RELEASE_BASE,
    movieBase: RELEASE_BASE
};


// -----------------------------------------------------
// PRIMITIVES
// -----------------------------------------------------

// Coerce to a finite number, or null.
// Guards every .toFixed() call downstream: a numeric string
// from the generator used to throw mid-template and blank
// the whole detail panel.
function num(v){

    if(v === null || v === undefined || v === '')
        return null;

    const n = typeof v === 'number' ? v : Number(v);

    return Number.isFinite(n) ? n : null;
}


function int(v){

    const n = num(v);

    return n === null ? null : Math.trunc(n);
}


function str(v){

    if(v === null || v === undefined)
        return null;

    const s = String(v).trim();

    return s === '' ? null : s;
}


// Accept only real booleans and the obvious stringly forms.
function bool(v){

    if(typeof v === 'boolean')
        return v;

    if(v === 'true'  || v === 1 || v === '1') return true;
    if(v === 'false' || v === 0 || v === '0') return false;

    return false;
}


// -----------------------------------------------------
// TIMESTAMPS
//
// The legacy inventory writes "2022-10-19 19:22:18.319500"
// — no T, no offset — which new Date() reads as LOCAL time.
// Normalising to an explicit Z here fixes the detail panel's
// mislabelled "UTC" and the tree/search date disagreement
// without touching any consumer.
//
// Naive timestamps are interpreted as UTC. That is correct
// for DKIST metadata, but it is an assumption; the validator
// warns whenever it has to be made.
// -----------------------------------------------------

function utc(v){

    const s = str(v);

    if(!s) return null;

    // Already carries a zone designator.
    if(/(Z|[+-]\d{2}:?\d{2})$/.test(s))
        return s.replace(' ', 'T');

    return s.replace(' ', 'T') + 'Z';
}


// -----------------------------------------------------
// DERIVED DISPLAY STRINGS
//
// Formatted here rather than in the inventory, so a cosmetic
// change on the generator side can no longer change the site
// without a code review. The pre-formatted fields survive as
// fallbacks only.
// -----------------------------------------------------

function formatDuration(seconds){

    const total = Math.floor(seconds);

    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;

    if(h > 0) return `${h}h ${m}m ${s}s`;
    if(m > 0) return `${m}m ${s}s`;

    return `${s}s`;
}


function formatShape(shape){

    return shape.map(n => String(n)).join(' × ');
}


// Stable machine key for the spectral line, e.g. fexiii_1074.
// Used for grouping/filtering; the label stays for display.
function derivedWavebandKey(waveband, lineWave){

    const label = str(waveband);

    if(!label)
        return null;

    const species = label
        .split('(')[0]
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');

    const nm = num(lineWave);

    // Truncate rather than round: 1074.7 and 1079.8 must stay distinct
    // and must keep the wavelength a reader recognises.
    return nm !== null
        ? `${species}_${Math.floor(nm)}`
        : species;
}


// -----------------------------------------------------
// MEDIA URL
// -----------------------------------------------------

function mediaURL(filename, base){

    const f = str(filename);

    if(!f)
        return null;

    // Let the inventory override per-record if it ever needs to.
    if(/^(https?:)?\/\//.test(f) || f.startsWith('/'))
        return f;

    return base + f;
}


// -----------------------------------------------------
// INACTIVE IDS
//
// Seen in the wild as an array, a bare string, the literal
// "nan", and null. Normalised to an array, always.
// -----------------------------------------------------

function inactiveIds(v){

    if(v === null || v === undefined)
        return [];

    const list = Array.isArray(v) ? v : [v];

    return list
        .map(str)
        .filter(x => x !== null && x.toLowerCase() !== 'nan');
}


// =====================================================
// RECORD ADAPTER
//
// Returns a superset of the legacy record: every field the
// existing consumers read keeps its name and meaning, plus
// the normalised additions. Downstream code needed no
// changes to adopt this.
// =====================================================

function adaptRecord(raw, key){

    const durationSeconds = num(raw.duration_seconds);

    const shape = Array.isArray(raw.dataset_shape)
        ? raw.dataset_shape.map(int).filter(n => n !== null)
        : null;

    const startTime = utc(raw.start_time);
    const endTime   = utc(raw.end_time);

    const waveband = str(raw.waveband);
    const lineWave = num(raw.line_wave);

    return {

        // ---- identity ----
        // The map key wins: it is what the rest of the site
        // indexes by, and the two agree in every record today.
        dataset_id:
            str(raw.dataset_id) || key,

        product_id:
            str(raw.product_id) || 'UNKNOWN_PRODUCT',

        observingProgramExecutionId:
            str(raw.observingProgramExecutionId) || 'UNKNOWN_PROGRAM',

        collection_id:
            str(raw.collection_id),

        // ---- classification ----
        dataset_type:
            str(raw.dataset_type),

        is_context_imager:
            bool(raw.is_context_imager),

        // ---- time ----
        start_time: startTime,
        end_time:   endTime,
        date_avg:   utc(raw.date_avg),

        // Real Date objects, parsed once, for sorting.
        start_date: startTime ? new Date(startTime) : null,
        end_date:   endTime   ? new Date(endTime)   : null,

        // Calendar date in UTC, taken as a string slice so it
        // can never disagree with what a Date parse would give.
        obs_date:
            startTime ? startTime.slice(0, 10) : null,

        duration_seconds: durationSeconds,

        duration:
            durationSeconds !== null
                ? formatDuration(durationSeconds)
                : (str(raw.duration) || null),

        // ---- spectral ----
        waveband: waveband,
        line_wave: lineWave,

        waveband_key:
            str(raw.waveband_key) || derivedWavebandKey(waveband, lineWave),

        // ---- provenance ----
        instrument:      str(raw.instrument),
        instrument_name: str(raw.instrument_name),
        observatory:     str(raw.observatory),
        telescope:       str(raw.telescope),
        observer:        str(raw.observer),
        object:          str(raw.object),

        // Only the basename is ever displayed; drop the
        // generating host's directory layout on the way in.
        metadata_file:
            str(raw.metadata_file)
                ? str(raw.metadata_file).split('/').pop()
                : null,

        // ---- shape ----
        dataset_shape: shape,

        dataset_shape_str:
            shape && shape.length
                ? formatShape(shape)
                : (str(raw.dataset_shape_str) || null),

        n_stokes:     int(raw.n_stokes),
        n_scanSteps:  int(raw.n_scanSteps),
        n_measAtStep: int(raw.n_measAtStep),
        n_alongSlit:  int(raw.n_alongSlit),
        n_wavelength: int(raw.n_wavelength),

        // ---- geometry ----
        stepWidth_arcsec:    num(raw.stepWidth_arcsec),
        slitSampling_arcsec: num(raw.slitSampling_arcsec),
        solar_radius_arcsec: num(raw.solar_radius_arcsec),
        slit_angle_deg:      num(raw.slit_angle_deg),
        crval1:              num(raw.crval1),
        crval2:              num(raw.crval2),

        scan_center_arcsec:
            Array.isArray(raw.scan_center_arcsec)
                ? raw.scan_center_arcsec.map(num)
                : null,

        // Two parallel arrays; anything else becomes null so
        // the footprint renderer's own guard takes over.
        spatial_bounds_arcsec:
            (Array.isArray(raw.spatial_bounds_arcsec) &&
             raw.spatial_bounds_arcsec.length === 2 &&
             Array.isArray(raw.spatial_bounds_arcsec[0]) &&
             Array.isArray(raw.spatial_bounds_arcsec[1]))
                ? [
                    raw.spatial_bounds_arcsec[0].map(num),
                    raw.spatial_bounds_arcsec[1].map(num)
                  ]
                : null,

        bbox_arcsec:      raw.bbox_arcsec || null,
        bbox_solar_radii: raw.bbox_solar_radii || null,

        // ---- archive ----
        inactive_dataset_ids:
            inactiveIds(raw.inactive_dataset_ids),

        // ---- media ----
        // Filenames kept for the captions; URLs resolved once.
        context_image:           str(raw.context_image),
        context_movie:           str(raw.context_movie),
        context_movie_thumbnail: str(raw.context_movie_thumbnail),

        context_image_url:
            mediaURL(raw.context_image, MEDIA.imageBase),

        context_movie_url:
            mediaURL(raw.context_movie, MEDIA.movieBase),

        context_movie_poster_url:
            mediaURL(raw.context_movie_thumbnail, MEDIA.movieBase),

        // ---- product context (inventory v1.0.0) ----
        // experiment_description is operator-authored prose; it is escaped
        // at render time, never here — the raw value is also used for
        // case-insensitive search matching.
        experiment_id:   str(raw.experiment_id),
        proposal_id:     str(raw.proposal_id),
        experiment_description: str(raw.experiment_description),

        observing_mode:    str(raw.observing_mode),
        arm:               str(raw.arm),
        stokes_parameters: str(raw.stokes_parameters),
        analysis_class:    str(raw.analysis_class),
        is_fittable:       raw.is_fittable === true,

        dataset_status:    str(raw.dataset_status),
        archived_status:   raw.archived_status || {},

        preview_url:       str(raw.preview_url),
        dataset_size_gib:  num(raw.dataset_size_gib),
        number_of_frames:  int(raw.number_of_frames),
        embargoed:         raw.embargoed === true,
        downloadable:      raw.downloadable !== false,

        calibration_workflow_version:
            str(raw.calibration_workflow_version)

        // Absolute *_path / spatial_npz / dataset_path fields
        // are deliberately dropped — see data/SCHEMA.md §2.
    };
}


// =====================================================
// INVENTORY ADAPTER
//
// Accepts the wrapped envelope, a bare keyed map, or an
// array of records. Returns { datasets, meta }.
// =====================================================

function adaptInventory(payload){

    if(!payload || typeof payload !== 'object')
        throw new Error('Inventory payload is not an object');

    const meta = {
        schema_version: payload.schema_version || null,
        generated_at:   payload.generated_at   || null,
        source:         payload.source         || null
    };

    let records = payload.datasets || payload;

    // An array of records is keyed by dataset_id on the way in.
    if(Array.isArray(records)){

        const keyed = {};

        records.forEach(r => {

            const id = r && (r.dataset_id || r.datasetId);

            if(id) keyed[id] = r;
        });

        records = keyed;
    }

    const datasets = {};

    Object.keys(records).forEach(key => {

        try{

            datasets[key] = adaptRecord(records[key], key);

        }catch(err){

            // One malformed record must not take down the archive.
            console.error(`Skipping dataset ${key}:`, err);
        }
    });

    // Superseded dataset IDs resolve to the product that replaced them, so a
    // link or bookmark using a pre-recalibration ID still lands somewhere.
    const aliases = {};

    const declared = payload.dataset_aliases;

    if(declared && typeof declared === 'object'){

        Object.keys(declared).forEach(oldId => {

            if(!datasets[oldId])
                aliases[oldId] = declared[oldId];
        });

    }else{

        // Legacy files carry no alias map; rebuild it from the records.
        Object.keys(datasets).forEach(key => {

            datasets[key].inactive_dataset_ids.forEach(oldId => {

                if(!datasets[oldId] && !aliases[oldId])
                    aliases[oldId] = key;
            });
        });
    }

    meta.n_aliases = Object.keys(aliases).length;

    return { datasets, meta, aliases };
}


// =====================================================
// LOOKUP
//
// Accepts a current dataset ID, a superseded one, or a
// product ID, and returns the record that should be shown.
// =====================================================

function resolveDataset(id){

    if(!id)
        return null;

    const key = String(id).trim().toUpperCase();

    if(datasetDB[key])
        return datasetDB[key];

    const aliased = datasetAliases[key];

    if(aliased && datasetDB[aliased])
        return datasetDB[aliased];

    // Fall back to a product ID scan — cheap at this size.
    const byProduct = Object.values(datasetDB)
        .find(d => d.product_id && d.product_id.toUpperCase() === key);

    return byProduct || null;
}
