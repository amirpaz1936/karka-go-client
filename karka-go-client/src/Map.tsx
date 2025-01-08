import React, { useEffect, useRef, useState } from 'react';
import 'ol/ol.css';
import { Map as OLMap } from 'ol';
import { View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import OSM from 'ol/source/OSM';
import TileWMS from 'ol/source/TileWMS';
import { Draw, Modify } from 'ol/interaction';
import { Style, Fill, Stroke } from 'ol/style';
import { Button, Box, Select as MuiSelect, MenuItem, FormControl, InputLabel, SelectChangeEvent } from '@mui/material';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import GeoJSON from 'ol/format/GeoJSON';

const Map: React.FC = () => {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapInstance = useRef<OLMap | null>(null);
  const vectorSourceRef = useRef<any>(new VectorSource());
  const modifyInteractionRef = useRef<Modify | null>(null);
  const [polygonFillColor, setPolygonFillColor] = useState<string>('yellow');
  const [drawInteraction, setDrawInteraction] = useState<Draw | null>(null);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [isUpdating, setIsUpdating] = useState<boolean>(false);
  const wmsSourceRef = useRef<TileWMS | null>(null);

  useEffect(() => {
    const israelCenterCoordinates = [700000, 3450000];

    if (mapRef.current && !mapInstance.current) {
      const wmsSource = new TileWMS({
        url: 'http://localhost:8080/geoserver/tiger/ows',
        params: {
          LAYERS: 'imunim',
          TILED: true,
          FORMAT: 'image/png',
          TRANSPARENT: true,
          CQL_FILTER: 'is_deleted=false',
        },
        serverType: 'geoserver',
      });

      wmsSourceRef.current = wmsSource;

      const wmsLayer = new TileLayer({
        source: wmsSource,
      });

      const vectorLayer = new VectorLayer({
        source: vectorSourceRef.current,
      });

      mapInstance.current = new OLMap({
        target: mapRef.current,
        layers: [
          new TileLayer({
            source: new OSM(),
          }),
          wmsLayer,
          vectorLayer,
        ],
        view: new View({
          projection: 'EPSG:32636',
          center: israelCenterCoordinates,
          zoom: 8,
        }),
      });

      mapInstance.current.getViewport().addEventListener('contextmenu', async (event) => {
        event.preventDefault();
        const coordinate = mapInstance.current!.getEventCoordinate(event);
        const viewResolution = mapInstance.current!.getView().getResolution();
        const url = wmsSource.getFeatureInfoUrl(
          coordinate,
          viewResolution!,
          'EPSG:32636',
          {
            INFO_FORMAT: 'application/json',
          }
        );

        if (url) {
          try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.features && data.features.length > 0) {
              const feature = data.features[0];
              const featureId = feature.id;
              const currentColor = feature.properties?.color || 'No color specified';
              const newColor = currentColor === 'black' ? 'yellow' : 'black';

              const editResponse = await fetch('http://localhost:3000/polygons/editColor', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  id: featureId,
                  color: newColor,
                }),
              });

              if (editResponse.ok) {
                const result = await editResponse.json();
                console.log('Color updated successfully:', result);
                wmsSourceRef.current?.updateParams({ _: new Date().getTime() });
              } else {
                const error = await editResponse.json();
                console.error('Error updating color:', error.error);
              }
            } else {
              console.log('No feature found at this location.');
            }
          } catch (error) {
            console.error('Error fetching feature info or updating color:', error);
          }
        }
      });  
      mapInstance.current.on('singleclick', async (event) => {
        const coordinate = event.coordinate;
        const viewResolution = mapInstance.current!.getView().getResolution();
        const url = wmsSource.getFeatureInfoUrl(
          coordinate,
          viewResolution!,
          'EPSG:32636',
          {
            INFO_FORMAT: 'application/json',
          }
        );

        if (url) {
          try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.features && data.features.length > 0) {
              const feature = new GeoJSON().readFeature(data.features[0]);
              vectorSourceRef.current.clear();
              vectorSourceRef.current.addFeature(feature);
              enableModifyInteraction();
              setIsUpdating(true);
            } else {
              console.log('No feature found at this location.');
            }
          } catch (error) {
            console.error(error);
          }
        }
      });

      mapInstance.current.on('dblclick', async (event) => {
        const viewResolution = mapInstance.current?.getView().getResolution();
        const url = wmsSource.getFeatureInfoUrl(
          event.coordinate,
          viewResolution!,
          'EPSG:32636',
          {
            INFO_FORMAT: 'application/json',
          }
        );

        if (url) {
          try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.features && data.features.length > 0) {
              const featureId = data.features[0].id;
              const deleteResponse = await fetch('http://localhost:3000/polygons/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: featureId }),
              });

              const result = await deleteResponse.json();
              if (deleteResponse.ok) {
                console.log('Polygon marked as deleted:', result);
                wmsSourceRef.current?.updateParams({ _: new Date().getTime() });
              } else {
                console.error(result.error);
              }
            } else {
              console.log('No feature found at this location.');
            }
          } catch (error) {
            console.error(error);
          }
        }
      });
    }
  }, []);

  const enableModifyInteraction = () => {
    if (modifyInteractionRef.current) {
      mapInstance.current?.removeInteraction(modifyInteractionRef.current);
    }

    const modifyInteraction = new Modify({
      source: vectorSourceRef.current,
    });

    modifyInteractionRef.current = modifyInteraction;
    mapInstance.current?.addInteraction(modifyInteraction);
  };

  const handleSaveUpdates = async () => {
    const features = vectorSourceRef.current.getFeatures();
    if (features.length > 0) {
      const geoJson = new GeoJSON().writeFeaturesObject(features);
      const featureId = features[0].getId();
  
      try {
        const response = await fetch('http://localhost:3000/polygons/edit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ geojson: geoJson, id: featureId }),
        });
  
        const result = await response.json();
        if (response.ok) {
          console.log(result.message);
  
          setIsUpdating(false);
          vectorSourceRef.current.clear();
          if (modifyInteractionRef.current) {
            mapInstance.current?.removeInteraction(modifyInteractionRef.current);
            modifyInteractionRef.current = null;
          }
  
          wmsSourceRef.current?.updateParams({ _: new Date().getTime() });
        } else {
          console.error(result.error);
        }
      } catch (error) {
        console.error(error);
      }
    } else {
      console.log('No feature available to update.');
    }
  };
  

  const handleDrawPolygon = () => {
    if (drawInteraction) {
      mapInstance.current?.removeInteraction(drawInteraction);
    }

    const newDrawInteraction = new Draw({
      source: vectorSourceRef.current,
      type: 'Polygon',
    });

    newDrawInteraction.on('drawend', (event) => {
      const feature = event.feature;
      feature.setProperties({ fillColor: polygonFillColor });
      feature.setStyle(
        new Style({
          fill: new Fill({
            color: polygonFillColor,
          }),
          stroke: new Stroke({
            color: 'black',
            width: 2,
          }),
        })
      );
      setIsEditing(true);
    });

    setDrawInteraction(newDrawInteraction);
    mapInstance.current?.addInteraction(newDrawInteraction);
  };

  const handleFillColorChange = (event: SelectChangeEvent<string>) => {
    setPolygonFillColor(event.target.value);
  };

  const handleSaveChanges = async () => {
    if (drawInteraction) {
      mapInstance.current?.removeInteraction(drawInteraction); 
      setDrawInteraction(null); 
    }

    const features = vectorSourceRef.current.getFeatures();
    const geoJson = new GeoJSON().writeFeaturesObject(features);

    try {
      const response = await fetch('http://localhost:3000/polygons', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geojson: geoJson }),
      });

      const result = await response.json();
      if (response.ok) {
        console.log(result.message);
        setIsEditing(false); 
      } else {
        console.error(result.error);
      }
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <div
        ref={mapRef}
        style={{
          width: '100vw',
          height: '100vh',
          margin: 0,
          padding: 0,
          overflow: 'hidden',
        }}
      />
      <Box
        sx={{
          position: 'absolute',
          top: 20,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
          backgroundColor: 'rgba(255, 255, 255, 0.7)',
          padding: '10px',
          borderRadius: '8px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        <Button variant="contained" onClick={handleDrawPolygon} sx={{ background:"#dcd622", color:"black", marginBottom: 2 }}>
          צייר פוליגון יא הומו
        </Button>
        <Button
          variant="contained"
          color="success"
          onClick={handleSaveChanges}
          disabled={!isEditing}
          sx={{ color:"#dcd622", background:"black", marginBottom: 2 }}
        >
          שמור יא הומו
        </Button>
        <Button
          variant="contained"
          color="primary"
          onClick={handleSaveUpdates}
          disabled={!isUpdating}
          sx={{ background:"#dcd622", color:"black", marginBottom: 2 }}
        >
          תעדכן את הציור של הפוליגון יא הומו
        </Button>
        <FormControl sx={{ marginBottom: 2 }}>
          <InputLabel>הפועל זונה</InputLabel>
          <MuiSelect
            value={polygonFillColor}
            label="Fill Color"
            onChange={handleFillColorChange}
          >
            <MenuItem value="yellow">צהוב</MenuItem>
            <MenuItem value="black">שחור</MenuItem>
          </MuiSelect>
        </FormControl>
      </Box>
    </div>
  );
};

export default Map;
