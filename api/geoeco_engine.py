from http.server import BaseHTTPRequestHandler
import json, os, math, hashlib, traceback

import ee

def init_ee():
    raw = os.environ.get("GEE_PRIVATE_KEY")
    email = os.environ.get("GEE_SERVICE_ACCOUNT")
    project = os.environ.get("GEE_PROJECT_ID")
    if not raw:
        raise RuntimeError("Missing GEE_PRIVATE_KEY")
    if raw.strip().startswith("{"):
        key = json.loads(raw)
        email = key.get("client_email") or email
        project = key.get("project_id") or project
        key_data = json.dumps(key)
    else:
        if not email:
            raise RuntimeError("Missing GEE_SERVICE_ACCOUNT")
        key_data = json.dumps({
            "type": "service_account",
            "client_email": email,
            "private_key": raw.replace("\\n", "\n"),
            "token_uri": "https://oauth2.googleapis.com/token"
        })
    if not project:
        raise RuntimeError("Missing GEE_PROJECT_ID")
    credentials = ee.ServiceAccountCredentials(email, key_data=key_data)
    ee.Initialize(credentials, project=project)

def aoi_geom(aoi):
    return ee.FeatureCollection(aoi).geometry()

def mask_s2(img):
    scl = img.select("SCL")
    mask = (scl.neq(0).And(scl.neq(1)).And(scl.neq(3)).And(
        scl.neq(8)).And(scl.neq(9)).And(scl.neq(10)).And(scl.neq(11)))
    return img.updateMask(mask).divide(10000).copyProperties(img, ["system:time_start"])

def s2_composite(start, end, geom):
    col = (ee.ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
           .filterDate(start, end).filterBounds(geom)
           .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 30))
           .map(mask_s2))
    count = col.size()
    empty = ee.Image.constant([0]*12).rename(
        ["B2","B3","B4","B5","B6","B7","B8","B8A","B9","B11","B12","AOT"]
    ).updateMask(ee.Image.constant(0))
    return ee.Image(ee.Algorithms.If(count.gt(0), col.median(), empty)), count

def indices(img):
    ndvi = img.normalizedDifference(["B8","B4"]).rename("NDVI")
    ndre = img.normalizedDifference(["B8A","B5"]).rename("NDRE")
    ndwi = img.normalizedDifference(["B3","B8"]).rename("NDWI")
    ndmi = img.normalizedDifference(["B8A","B11"]).rename("NDMI")
    evi = img.expression(
        "2.5*((n-r)/(n+6*r-7.5*b+1))",
        {"n":img.select("B8"),"r":img.select("B4"),"b":img.select("B2")}
    ).rename("EVI")
    savi = img.expression(
        "1.5*((n-r)/(n+r+0.5))",
        {"n":img.select("B8"),"r":img.select("B4")}
    ).rename("SAVI")
    bsi = img.expression(
        "((s+r)-(n+b))/((s+r)+(n+b))",
        {"s":img.select("B11"),"r":img.select("B4"),"n":img.select("B8"),"b":img.select("B2")}
    ).rename("BSI")
    return ee.Image.cat([ndvi, ndre, ndwi, ndmi, evi, savi, bsi])

def prep_lst(img):
    qa = img.select("QA_PIXEL")
    mask = qa.bitwiseAnd(1<<3).eq(0).And(qa.bitwiseAnd(1<<4).eq(0)).And(img.select("QA_RADSAT").eq(0))
    return img.updateMask(mask).select("ST_B10").multiply(0.00341802).add(149).subtract(273.15).rename("LST")

def lst_composite(start, end, geom):
    col = (ee.ImageCollection("LANDSAT/LC08/C02/T1_L2")
           .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
           .filterDate(start, end).filterBounds(geom)
           .filter(ee.Filter.eq("PROCESSING_LEVEL","L2SP"))
           .map(prep_lst))
    empty = ee.Image.constant(0).rename("LST").updateMask(ee.Image.constant(0))
    return ee.Image(ee.Algorithms.If(col.size().gt(0), col.median(), empty)), col.size()

def bounds_geojson(fc):
    pts=[]
    def walk(x):
        if isinstance(x, list):
            if len(x)>=2 and isinstance(x[0], (int,float)) and isinstance(x[1], (int,float)):
                pts.append((x[0],x[1]))
            else:
                for y in x: walk(y)
    for f in fc.get("features",[]):
        walk((f.get("geometry") or {}).get("coordinates"))
    if not pts: return None
    xs=[p[0] for p in pts]; ys=[p[1] for p in pts]
    return [[min(ys),min(xs)],[max(ys),max(xs)]]

def finite(v):
    try:
        return v is not None and math.isfinite(float(v))
    except:
        return False

def classify(img, thresholds):
    cls = ee.Image(1)
    for i,t in enumerate(thresholds):
        cls = cls.where(img.gt(t), i+2)
    return cls.rename("class").updateMask(img.mask())

def layer_image(layer, start, end, geom):
    if layer in ["NDVI","NDRE","NDWI","NDMI","BSI"]:
        s2,_ = s2_composite(start,end,geom)
        idx = indices(s2)
        return idx.select(layer).rename("value")
    if layer == "LST":
        lst,_ = lst_composite(start,end,geom)
        return lst.rename("value")
    raise RuntimeError("Unsupported layer for stable engine: "+layer)

def map_analysis(p):
    geom = aoi_geom(p["aoi"])
    area_ha = float(geom.area(1).divide(10000).getInfo())
    simplify_m = 250 if area_ha>1000000 else 150 if area_ha>250000 else 75 if area_ha>50000 else 30
    g = geom.simplify(simplify_m)
    start = str(p.get("start","2024-01-01"))
    end = str(p.get("end","2026-09-19"))
    layer = str(p.get("layer","NDVI")).upper()
    img = layer_image(layer,start,end,g)
    base = 60 if layer=="LST" else 20
    scale = max(base, 300 if area_ha>1000000 else 180 if area_ha>250000 else 90 if area_ha>50000 else base)
    reducer = ee.Reducer.mean().combine(ee.Reducer.stdDev(), sharedInputs=True).combine(
        ee.Reducer.percentile([20,40,60,80]), sharedInputs=True)
    st = img.reduceRegion(reducer=reducer, geometry=g, scale=scale, maxPixels=50000000,
                          bestEffort=True, tileScale=8).getInfo()
    th = [st.get("value_p20"),st.get("value_p40"),st.get("value_p60"),st.get("value_p80")]
    if not all(finite(x) for x in th):
        raise RuntimeError("Insufficient valid pixels for classification")
    th=[float(x) for x in th]
    cls = classify(img, th)
    palette = ["#7f3b08","#b35806","#f1a340","#998ec3","#542788"] if layer!="LST" else ["#313695","#74add1","#ffffbf","#f46d43","#a50026"]
    grouped = (ee.Image.pixelArea().divide(10000).rename("ha").addBands(cls)
               .reduceRegion(reducer=ee.Reducer.sum().group(groupField=1,groupName="class"),
                             geometry=g, scale=scale, maxPixels=50000000, bestEffort=True, tileScale=8)
               .getInfo())
    class_area=[{"class":x.get("class"),"areaHa":x.get("sum")} for x in grouped.get("groups",[])]
    dim = 512 if area_ha>1000000 else 640 if area_ha>250000 else 900
    thumb = cls.getThumbURL({
        "region": g.bounds(100),
        "dimensions": dim,
        "format":"png",
        "min":1,
        "max":5,
        "palette":palette
    })
    labels=["Very Low","Low","Moderate","High","Very High"]
    legend=[]
    for i,label in enumerate(labels):
        legend.append({
            "class":i+1,"label":label,"color":palette[i],
            "min":None if i==0 else th[i-1],
            "max":None if i==4 else th[i]
        })
    return {
        "status":"success","layer":layer,"imageUrl":thumb,"bounds":bounds_geojson(p["aoi"]),
        "legend":legend,"areaHa":area_ha,
        "stats":{"mean":st.get("value_mean"),"stdDev":st.get("value_stdDev"),"thresholds":th},
        "classArea":class_area,
        "methodology":{"type":"relative AOI quintile visualization","classes":"P20/P40/P60/P80","validation":"Spectral index; no universal ecological threshold implied"},
        "provenance":{"engine":"Python Earth Engine API","version":"GEOECO-PY-MAP-1.0.0","start":start,"end":end,"scale":scale,"areaHa":area_ha,"simplifyMeters":simplify_m}
    }

def stats_analysis(p):
    geom=aoi_geom(p["aoi"])
    area_ha=float(geom.area(1).divide(10000).getInfo())
    start=str(p.get("start","2024-01-01")); end=str(p.get("end","2026-09-19"))
    scale=300 if area_ha>1000000 else 180 if area_ha>250000 else 120 if area_ha>50000 else 90
    count=900 if area_ha>1000000 else 1000 if area_ha>250000 else 1200
    s2,s2n=s2_composite(start,end,geom)
    idx=indices(s2)
    lst,lcn=lst_composite(start,end,geom)
    days=max(1.0,float(ee.Date(end).difference(ee.Date(start),"day").getInfo()))
    rain=(ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").filterDate(start,end).filterBounds(geom)
          .sum().multiply(365.25/days).rename("Rainfall"))
    dem=ee.Image("USGS/SRTMGL1_003").select("elevation").rename("Elevation")
    slope=ee.Terrain.slope(dem).rename("Slope")
    stack=ee.Image.cat([idx,lst,rain,dem,slope]).clip(geom)
    smp=(stack.sample(region=geom, scale=scale, numPixels=count, seed=42,
                      geometries=False, tileScale=8, dropNulls=True).limit(count).getInfo())
    keys=["NDVI","NDRE","NDWI","NDMI","EVI","SAVI","BSI","LST","Rainfall","Elevation","Slope"]
    rows=[]
    for f in smp.get("features",[]):
        pr=f.get("properties",{})
        row={k:(float(pr[k]) if finite(pr.get(k)) else None) for k in keys}
        if any(v is not None for v in row.values()): rows.append(row)
    aid="GEOECO-S-"+hashlib.sha256(json.dumps({"aoi":p["aoi"],"start":start,"end":end,"scale":scale,"seed":42},sort_keys=True).encode()).hexdigest()[:12].upper()
    return {
        "status":"success","mode":"spatial-sample","analysisId":aid,"rows":rows,"variables":keys,
        "areaHa":area_ha,"sampleCountRequested":count,"sampleCountReturned":len(rows),
        "provenance":{"engine":"Python Earth Engine API","version":"GEOECO-PY-STATS-1.0.0","datasets":["Sentinel-2 SR Harmonized","Landsat 8/9 C2 L2","CHIRPS","SRTM"],"start":start,"end":end,"sampleScale":scale,"seed":42},
        "limitations":"Reproducible spatial sample. Correlation and regression describe spatial association, not causality; spatial autocorrelation and different native resolutions remain relevant."
    }

class handler(BaseHTTPRequestHandler):
    def _send(self, code, obj):
        body=json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type","application/json; charset=utf-8")
        self.send_header("Content-Length",str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        try:
            init_ee()
            aoi={"type":"FeatureCollection","features":[{"type":"Feature","properties":{},"geometry":{"type":"Polygon","coordinates":[[[114.55,-3.45],[114.65,-3.45],[114.65,-3.35],[114.55,-3.35],[114.55,-3.45]]]}}]}
            x=stats_analysis({"aoi":aoi,"start":"2026-01-01","end":"2026-09-01"})
            self._send(200,{"status":"success","sampleCountReturned":x["sampleCountReturned"],"analysisId":x["analysisId"],"engine":"python-ee"})
        except Exception as e:
            self._send(500,{"status":"error","note":str(e),"trace":traceback.format_exc()[-1500:]})

    def do_POST(self):
        try:
            length=int(self.headers.get("content-length","0"))
            payload=json.loads(self.rfile.read(length) or b"{}")
            init_ee()
            action=str(payload.get("action","stats"))
            if action=="map":
                out=map_analysis(payload)
            else:
                out=stats_analysis(payload)
            self._send(200,out)
        except Exception as e:
            self._send(500,{"status":"error","note":str(e),"trace":traceback.format_exc()[-1500:]})
