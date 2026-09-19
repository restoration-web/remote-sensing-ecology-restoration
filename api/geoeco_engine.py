from http.server import BaseHTTPRequestHandler
import json, os, math, hashlib, traceback, base64, urllib.request

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

def _norm(img, band, geom, scale):
    mm=(img.select(band).reduceRegion(
        reducer=ee.Reducer.minMax(),geometry=geom,scale=scale,
        maxPixels=20000000,bestEffort=True,tileScale=8).getInfo() or {})
    mn=mm.get(band+"_min"); mx=mm.get(band+"_max")
    if not finite(mn) or not finite(mx) or float(mx)==float(mn):
        return ee.Image.constant(0.5).rename(band+"_norm").clip(geom)
    return img.select(band).subtract(float(mn)).divide(float(mx)-float(mn)).clamp(0,1).rename(band+"_norm")

def susceptibility_image(layer, start, end, geom):
    s2,_=s2_composite(start,end,geom)
    ndvi=indices(s2).select("NDVI").rename("NDVI")
    dem=ee.Image("USGS/SRTMGL1_003").select("elevation").clip(geom).rename("Elevation")
    slope=ee.Terrain.slope(dem).rename("Slope")
    rain=(ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY")
          .filterDate(start,end).filterBounds(geom).sum().rename("Rainfall").clip(geom))
    n_ndvi=ndvi.add(1).divide(2).clamp(0,1)
    low_ndvi=ee.Image(1).subtract(n_ndvi)
    n_slope=_norm(slope,"Slope",geom,90)
    n_dem=_norm(dem,"Elevation",geom,90)
    n_rain=_norm(rain,"Rainfall",geom,5000)

    if layer=="EROSION":
        # Screening-level erosion susceptibility, not RUSLE soil-loss rate.
        out=n_slope.multiply(0.45).add(n_rain.multiply(0.30)).add(low_ndvi.multiply(0.25))
        return out.rename("value"), {
            "type":"relative screening susceptibility",
            "classes":"0-0.2/0.2-0.4/0.4-0.6/0.6-0.8/>0.8",
            "validation":"Not locally calibrated; does not estimate t ha-1 yr-1",
            "weights":{"slope":0.45,"rainfall":0.30,"lowNDVI":0.25}
        }
    if layer=="FLOOD":
        low_dem=ee.Image(1).subtract(n_dem)
        low_slope=ee.Image(1).subtract(n_slope)
        out=low_dem.multiply(0.35).add(low_slope.multiply(0.25)).add(n_rain.multiply(0.25)).add(low_ndvi.multiply(0.15))
        return out.rename("value"), {
            "type":"relative screening susceptibility",
            "classes":"0-0.2/0.2-0.4/0.4-0.6/0.6-0.8/>0.8",
            "validation":"Not locally calibrated; not flood probability or inundation depth",
            "weights":{"lowElevation":0.35,"lowSlope":0.25,"rainfall":0.25,"lowNDVI":0.15}
        }
    if layer=="LANDSLIDE":
        out=n_slope.multiply(0.45).add(n_rain.multiply(0.30)).add(n_dem.multiply(0.10)).add(low_ndvi.multiply(0.15))
        return out.rename("value"), {
            "type":"relative screening susceptibility",
            "classes":"0-0.2/0.2-0.4/0.4-0.6/0.6-0.8/>0.8",
            "validation":"Not locally calibrated; geology, lithology, roads, and soil strength are not yet included",
            "weights":{"slope":0.45,"rainfall":0.30,"elevation":0.10,"lowNDVI":0.15}
        }
    raise RuntimeError("Unsupported susceptibility layer: "+layer)

def layer_image(layer, start, end, geom):
    if layer in ["NDVI","NDRE","NDWI","NDMI","BSI"]:
        s2,_ = s2_composite(start,end,geom)
        idx = indices(s2)
        return idx.select(layer).rename("value"), None
    if layer == "LST":
        lst,_ = lst_composite(start,end,geom)
        return lst.rename("value"), None
    if layer in ["EROSION","FLOOD","LANDSLIDE"]:
        return susceptibility_image(layer,start,end,geom)
    raise RuntimeError("Unsupported layer for stable engine: "+layer)

def map_analysis(p):
    geom = aoi_geom(p["aoi"])
    area_ha = float(geom.area(1).divide(10000).getInfo())
    simplify_m = 250 if area_ha>1000000 else 150 if area_ha>250000 else 75 if area_ha>50000 else 30
    g = geom.simplify(simplify_m)
    start = str(p.get("start","2024-01-01"))
    end = str(p.get("end","2026-09-19"))
    layer = str(p.get("layer","NDVI")).upper()
    img, model_meta = layer_image(layer,start,end,g)
    is_model = layer in ["EROSION","FLOOD","LANDSLIDE"]
    base = 90 if is_model else (60 if layer=="LST" else 20)
    scale = max(base, 300 if area_ha>1000000 else 180 if area_ha>250000 else 90 if area_ha>50000 else base)
    if is_model:
        reducer = ee.Reducer.mean().combine(ee.Reducer.stdDev(), sharedInputs=True)
        st = img.reduceRegion(reducer=reducer, geometry=g, scale=scale, maxPixels=50000000,
                              bestEffort=True, tileScale=8).getInfo()
        th=[0.2,0.4,0.6,0.8]
    else:
        reducer = ee.Reducer.mean().combine(ee.Reducer.stdDev(), sharedInputs=True).combine(
            ee.Reducer.percentile([20,40,60,80]), sharedInputs=True)
        st = img.reduceRegion(reducer=reducer, geometry=g, scale=scale, maxPixels=50000000,
                              bestEffort=True, tileScale=8).getInfo()
        th = [st.get("value_p20"),st.get("value_p40"),st.get("value_p60"),st.get("value_p80")]
        if not all(finite(x) for x in th):
            raise RuntimeError("Insufficient valid pixels for classification")
        th=[float(x) for x in th]
    cls = classify(img, th)
    palette = (["#2c7bb6","#abd9e9","#ffffbf","#fdae61","#d7191c"] if is_model else
               (["#313695","#74add1","#ffffbf","#f46d43","#a50026"] if layer=="LST" else
                ["#7f3b08","#b35806","#f1a340","#998ec3","#542788"]))
    display_mask=ee.Image.constant(1).clip(geom).selfMask()
    display_cls=cls.clip(geom).updateMask(display_mask)
    grouped = (ee.Image.pixelArea().divide(10000).rename("ha").addBands(display_cls)
               .reduceRegion(reducer=ee.Reducer.sum().group(groupField=1,groupName="class"),
                             geometry=geom, scale=scale, maxPixels=50000000, bestEffort=True, tileScale=8)
               .getInfo())
    class_area=[{"class":x.get("class"),"areaHa":x.get("sum")} for x in grouped.get("groups",[])]
    dim = 512 if area_ha>1000000 else 640 if area_ha>250000 else 900
    visual=display_cls.visualize(min=1,max=5,palette=palette).updateMask(display_mask).clip(geom)
    thumb_url = visual.getThumbURL({
        "region": geom.bounds(100),
        "dimensions": dim,
        "format":"png"
    })
    with urllib.request.urlopen(thumb_url, timeout=120) as resp:
        png_bytes=resp.read()
    if not png_bytes:
        raise RuntimeError("Earth Engine returned an empty raster image")
    thumb="data:image/png;base64,"+base64.b64encode(png_bytes).decode("ascii")
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
        "methodology":(model_meta if model_meta else {"type":"relative AOI quintile visualization","classes":"P20/P40/P60/P80","validation":"Spectral index; no universal ecological threshold implied"}),
        "provenance":{"engine":"Python Earth Engine API","version":"GEOECO-PY-MAP-1.2.0","start":start,"end":end,"scale":scale,"areaHa":area_ha,"simplifyMeters":simplify_m,"displayClip":"exact uploaded AOI geometry","rasterTransport":"embedded PNG data URI"}
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


def haversine_km(a,b):
    R=6371.0
    p1=math.radians(a["lat"]); p2=math.radians(b["lat"])
    dlat=math.radians(b["lat"]-a["lat"]); dlon=math.radians(b["lon"]-a["lon"])
    q=math.sin(dlat/2)**2 + math.cos(p1)*math.cos(p2)*math.sin(dlon/2)**2
    return 2*R*math.asin(math.sqrt(q))

def fire_analysis(p):
    geom=aoi_geom(p["aoi"])
    context_buffer_km=min(100,max(0,float(p.get("contextBufferKm",25))))
    context_geom=geom.buffer(context_buffer_km*1000)
    end=str(p.get("end","2026-09-19"))
    days=min(30,max(1,int(p.get("days",7))))
    response_window=min(720,max(15,int(p.get("responseWindowMinutes",60))))
    e=ee.Date(end).advance(1,"day")
    s=e.advance(-days,"day")

    snpp=(ee.ImageCollection("NASA/LANCE/SNPP_VIIRS/C2")
          .filterDate(s,e).filterBounds(context_geom))
    noaa=(ee.ImageCollection("NASA/LANCE/NOAA20_VIIRS/C2")
          .filterDate(s,e).filterBounds(geom))
    col=snpp.merge(noaa).sort("system:time_start")
    image_count=int(col.size().getInfo() or 0)

    empty_result={
        "status":"success",
        "source":"NASA FIRMS / VIIRS 375 m NRT via Google Earth Engine",
        "period":{"days":days,"end":end,"contextBufferKm":context_buffer_km},
        "bounds":bounds_geojson(p["aoi"]),
        "points":[],
        "summary":{"count":0,"frpMean":None,"frpMax":None,"highConfidenceCount":0,"nominalOrHighCount":0,"latestEpoch":None},
        "goldenTime":None,
        "spreadProxy":{"available":False,"note":"No VIIRS hotspot detections were found in the AOI and selected period."},
        "vegetationContext":None,
        "scientificNote":"No active-fire detections were found for the AOI and selected period. Zero detections do not prove that no fire occurred; cloud, overpass timing, sensor limits, and fire size can affect detection.",
        "provenance":{"engine":"Python Earth Engine API","version":"GEOECO-PY-FIRE-1.1.0","datasets":["NASA/LANCE/SNPP_VIIRS/C2","NASA/LANCE/NOAA20_VIIRS/C2"],"hotspotResolutionM":375,"responseWindowMinutes":response_window,"imageCount":image_count,"validHotspotPixels":0}
    }
    if image_count<=0:
        return empty_result

    frp_max=col.select("frp").max().rename("frp").clip(context_geom)
    valid_dict=(frp_max.gt(0).selfMask().reduceRegion(
        reducer=ee.Reducer.count(),geometry=context_geom,scale=375,maxPixels=10000000,
        bestEffort=True,tileScale=4).getInfo() or {})
    valid_pixels=int(valid_dict.get("frp") or 0)
    if valid_pixels<=0:
        return empty_result

    hotspot_mask=frp_max.gt(0).selfMask()
    latest=col.qualityMosaic("acq_epoch").clip(context_geom)
    fire_bands=latest.select(["frp","confidence","Bright_ti4","acq_epoch"]).updateMask(hotspot_mask)
    inside=ee.Image.constant(1).clip(geom).unmask(0).rename("insideAOI")
    pts=(fire_bands.addBands(inside).addBands(ee.Image.pixelLonLat()).sample(
        region=context_geom,scale=375,geometries=True,numPixels=900,seed=42,tileScale=4).getInfo())

    points=[]
    for feat in pts.get("features",[]):
        pr=feat.get("properties",{})
        co=(feat.get("geometry") or {}).get("coordinates",[])
        if len(co)<2: continue
        frp=float(pr.get("frp") or 0)
        if frp<=0: continue
        points.append({
            "lon":float(co[0]),"lat":float(co[1]),"frp":frp,
            "confidence":int(pr.get("confidence") if pr.get("confidence") is not None else -1),
            "brightness":float(pr.get("Bright_ti4") or 0),
            "epoch":float(pr.get("acq_epoch") or 0),
            "insideAOI":bool((pr.get("insideAOI") or 0)>=0.5)
        })

    temporal=sorted([x for x in points if x["epoch"]>0],key=lambda x:x["epoch"])
    spread={"available":False,"note":"At least two time-separated hotspot detections are required."}
    if len(temporal)>=2:
        a,b=temporal[0],temporal[-1]
        hours=(b["epoch"]-a["epoch"])/3600.0
        dist=haversine_km(a,b)
        spread={
            "available":hours>0,
            "distanceKm":dist,
            "elapsedHours":hours,
            "centroidDisplacementKmPerHour":(dist/hours if hours>0 else None),
            "note":"Displacement proxy between earliest and latest sampled satellite hotspot detections; not physical flame-front rate of spread."
        }

    latest_epoch=max([x["epoch"] for x in points],default=None)
    golden=None
    if latest_epoch:
        import datetime
        end_dt=datetime.datetime.fromisoformat(end+"T23:59:59+00:00")
        age_h=max(0,(end_dt.timestamp()-latest_epoch)/3600.0)
        elapsed_min=age_h*60.0
        golden={
            "responseWindowMinutes":response_window,
            "elapsedSinceLatestDetectionMinutes":elapsed_min,
            "withinWindow":elapsed_min<=response_window,
            "status":"WITHIN CONFIGURED RESPONSE WINDOW" if elapsed_min<=response_window else "CONFIGURED RESPONSE WINDOW EXCEEDED",
            "note":"Operational response-window proxy, not a universal ecological threshold."
        }

    context=None
    if points:
        s2,_=s2_composite(ee.Date(end).advance(-45,"day").format("YYYY-MM-dd").getInfo(),
                          ee.Date(end).advance(1,"day").format("YYYY-MM-dd").getInfo(),context_geom)
        idx=indices(s2).select(["NDVI","NDMI","BSI"])
        hctx=idx.updateMask(hotspot_mask.reproject(crs="EPSG:4326",scale=375))
        context=(hctx.reduceRegion(
            reducer=ee.Reducer.mean().combine(ee.Reducer.stdDev(),sharedInputs=True),
            geometry=context_geom,scale=750,maxPixels=5000000,bestEffort=True,tileScale=8).getInfo() or {})

    inside_points=[x for x in points if x.get("insideAOI")]
    context_points=[x for x in points if not x.get("insideAOI")]
    summary={
        "count":len(points),
        "insideAOICount":len(inside_points),
        "contextCount":len(context_points),
        "frpMean":(sum(x["frp"] for x in points)/len(points) if points else None),
        "frpMax":(max(x["frp"] for x in points) if points else None),
        "highConfidenceCount":sum(1 for x in points if x["confidence"]>=2),
        "nominalOrHighCount":sum(1 for x in points if x["confidence"]>=1),
        "latestEpoch":latest_epoch
    }

    return {
        "status":"success",
        "source":"NASA FIRMS / VIIRS 375 m NRT via Google Earth Engine",
        "period":{"days":days,"end":end},
        "bounds":bounds_geojson(p["aoi"]),
        "points":points[:600],
        "summary":summary,
        "goldenTime":golden,
        "spreadProxy":spread,
        "vegetationContext":context,
        "scientificNote":"VIIRS NRT active-fire detections support monitoring but are not final science-quality fire perimeters. Hotspot pixels do not directly represent burned area or flame-front position.",
        "provenance":{"engine":"Python Earth Engine API","version":"GEOECO-PY-FIRE-1.0.0","datasets":["NASA/LANCE/SNPP_VIIRS/C2","NASA/LANCE/NOAA20_VIIRS/C2","COPERNICUS/S2_SR_HARMONIZED"],"hotspotResolutionM":375,"responseWindowMinutes":response_window,"imageCount":image_count,"validHotspotPixels":valid_pixels}
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
            elif action=="fire":
                out=fire_analysis(payload)
            else:
                out=stats_analysis(payload)
            self._send(200,out)
        except Exception as e:
            self._send(500,{"status":"error","note":str(e),"trace":traceback.format_exc()[-1500:]})
