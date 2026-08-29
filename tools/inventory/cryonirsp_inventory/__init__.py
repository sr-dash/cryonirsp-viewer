"""
Cryo-NIRSP Level-1 dataset inventory.

Builds a product-centric inventory of every DKIST Cryo-NIRSP Level-1 dataset
from the DKIST Data Center search API (via sunpy/Fido), downloads *only* the
metadata ASDF files, and enriches the inventory with the structural and
geometric detail needed to route datasets into cn-specfit / cnpolfit.

Stages (see ``cryonirsp_inventory.cli``)::

    search  ->  query the data centre, group datasets by Product ID
    fetch   ->  download the metadata ASDF of each ACTIVE dataset
    enrich  ->  read the local ASDFs for structure/geometry
    report  ->  human readable summary tables
"""

__version__ = "1.0.0"

from .classify import classify_product, describe_spectral_line
from .inventory import Inventory, load_inventory, save_inventory
from .search import build_products, search_cryonirsp

__all__ = [
    "Inventory",
    "build_products",
    "classify_product",
    "describe_spectral_line",
    "load_inventory",
    "save_inventory",
    "search_cryonirsp",
]
