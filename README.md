# Geospatial Ecological Restoration Assessment

Q1-oriented research web-GIS for post-mining restoration analysis.

## Core outputs
- Interactive AOI analysis
- NDVI, EVI, SAVI, FVC, NDMI, NDWI, BSI, LST
- Rainfall, elevation, slope, reclamation age
- Recovery trajectory, Mann–Kendall, Sen's slope, PCA, correlation, regression, validation
- Publication map builder: study area and result maps at 300/600 dpi, single/double-column profiles
- Q1 paper package: DOCX/PDF Methods & Results, CSV/XLSX tables, PNG/TIFF/SVG maps, GeoTIFF rasters

## Backend compatibility
Set `EXISTING_GEE_BACKEND_URL` to preserve the previous Google Earth Engine backend. Alternatively wire the previous GEE service-account handler directly into `/app/api/analyze/route.ts`.

Do not commit GEE credentials. Keep GEE_PROJECT_ID, GEE_SERVICE_ACCOUNT and GEE_PRIVATE_KEY in Vercel Environment Variables.
