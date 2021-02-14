# npm-vwconnectapi
NPM package for a VW Connect API based on https://github.com/TA2k/ioBroker.vw-connect


### Example:

```javascript
const api = require('npm-vwconnectapi');
var log = new api.Log();
var vwConn = new api.VwWeConnect();
vwConn.setCredentials("YourEmail", "YourPassword", "YourPin");
vwConn.setConfig("id"); // type
vwConn.getData()

var intervalid = setInterval(function() {
  if (vwConn.finishedReading())
  {
    // log State of Charge
    log.info("State of Charge: " + vwConn.IdData.data.batteryStatus.currentSOC_pct + "%");
    
    log.info("Charging records:");
    vwConn.homechargingRecords.forEach((record) =>
      {
        log.info(record.start_date_time + ": " + record.total_energy_wh/1000 + "kWh");
      }
    );
    
    vwConn.onUnload();
    process.exit(1);
  }
  log.info("Waiting for data ...");
}, 1000);
```

### Objects supplied by the API:

#### vwConn.vehicles - List of vehicles
```
{
  "data": [
  {
    "vin":"WVWZZZE1ZMP123456",
    "role":"PRIMARY_USER",
    "enrollmentStatus":"COMPLETED",
    "model":"test",
    "nickname":"ID.3",
    "capabilities": [
      { "id":"access", "status":[1008], "userDisablingAllowed":false },
      { "id":"automation", "expirationDate":"2024-01-11T00:00:00Z", "userDisablingAllowed":true },
      { "id":"charging", "expirationDate":"2024-01-11T00:00:00Z", "userDisablingAllowed":true},
      { "id":"chargingStations", "status":[4001], "expirationDate":"2024-01-11T00:00:00Z", "userDisablingAllowed":true},
      { "id":"climatisation", "expirationDate":"2024-01-11T00:00:00Z", "userDisablingAllowed":true },
      { "id":"destinations", "expirationDate":"2024-01-11T00:00:00Z", "userDisablingAllowed":true },
      { "id":"fuelStatus", "userDisablingAllowed":false },
      { "id":"ignition", "status":[1008], "userDisablingAllowed":false },
      { "id":"mapUpdate", "status":[4001], "expirationDate":"2024-01-11T00:00:00Z", "userDisablingAllowed":true },
      { "id":"measurements", "status":[1008], "userDisablingAllowed":false },
      { "id":"onlineSpeech", "expirationDate":"2024-01-11T00:00:00Z", "userDisablingAllowed":true },
      { "id":"parkingPosition", "status":[1008], "userDisablingAllowed":false },
      { "id":"routing", "expirationDate":"2024-01-11T00:00:00Z", "userDisablingAllowed":true },
      { "id":"state", "status":[1008], "userDisablingAllowed":false },
      { "id":"trafficInformation", "status":[4001], "expirationDate":"2024-01-11T00:00:00Z", "userDisablingAllowed":true },
      { "id":"vehicleLights", "status":[1008], "userDisablingAllowed":false },
      { "id":"webRadio", "expirationDate":"2024-01-11T00:00:00Z", "userDisablingAllowed":true }
    ],
    "images": {}
  }
  ]
}
```

#### vwConn.stations - List of wallboxes
```
[
{
  "connection_state":"connected",
  "connectors": [
    {
    "availability":"available",
    "id":"1"
    }
  ],
  "id": "asdfd-asdf-asdf-abbd-dfasfasdfsdf",
  "last_contact":"2021-02-14T14:36:16.815Z",
  "lifecycle_state":"activated",
  "name":"Zuhause",
  "authorization_mode":"authorization_csms",
  "model":"EVBOX_MGWB"
}
]
```

#### vwConn.homechargingRecords - Charging records of the wallbox
```
[
{
 "authentication_method":"private_card_owned", // none / private_card_owned / ???
 "authorization_mode":"authorization_csms", // no_authorization_cs / authorization_csms / ???
 "charging_session_id":"0ab26cbe-4421-47f0-bd4b-asfasfdsdsd",
 "connector_id":1,
 "rfid_card_id":"e1f2b4de-c265-46da-8307-sfasfsdf", // optional, only when authentication_method != none
 "rfid_card_label":"We Charge Wallbox Card", // optional, only when authentication_method != none
 "rfid_card_serial_number":"VW-ASDFASDF-asdf-1", // optional, only when authentication_method != none
 "session_faulted":false,
 "start_date_time":"2021-02-10T11:21:56.000Z",
 "station_id":"d29f2eb8-asdf-asdf-asdf-asdfsdfds",
 "station_name":"Zuhause",
 "station_serial_number":"1055dfsdfas",
 "stop_date_time":"2021-02-12T19:26:13.000Z",
 "total_energy_wh":"17230",
 "transaction_id":"ba75dcf5-3146-4453-a9a1-asdfewasdfs",
 "station_model":"EVBOX_MGWB",
 "current_station_name":"Zuhause"
},
{
...more records...
}
]
```
#### vwConn.IdData - Car data for the IDs
```
{
  "data": {
    "batteryStatus": {
      "carCapturedTimestamp":"2021-02-13T10:38:00Z",
      "currentSOC_pct":67,
      "cruisingRangeElectric_km":199
    },
    "chargingStatus": {
      "carCapturedTimestamp":"2021-02-13T10:38:00Z",
      "remainingChargingTimeToComplete_min":0,
      "chargingState":"readyForCharging",
      "chargePower_kW":0,
      "chargeRate_kmph":0
    },
    "chargingSettings": {
      "carCapturedTimestamp":"2021-02-13T10:37:20Z",
      "maxChargeCurrentAC":"maximum",
      "autoUnlockPlugWhenCharged":"off",
      "targetSOC_pct":80
    },
    "plugStatus": {
      "carCapturedTimestamp":"2021-02-13T10:38:04Z",
      "plugConnectionState":"disconnected",
      "plugLockState":"unlocked"
    },
    "climatisationStatus": {
      "carCapturedTimestamp":"2021-02-13T10:37:22Z",
      "remainingClimatisationTime_min":0,
      "climatisationState":"off"
    },
    "climatisationSettings": {
      "carCapturedTimestamp":"2021-02-13T10:37:22Z",
      "targetTemperature_K":295.15,
      "targetTemperature_C":22,
      "climatisationWithoutExternalPower":true,
      "climatizationAtUnlock":false,
      "windowHeatingEnabled":false,
      "zoneFrontLeftEnabled":false,
      "zoneFrontRightEnabled":false,
      "zoneRearLeftEnabled":false,
      "zoneRearRightEnabled":false
    },
    "climatisationTimer": {
      "timers": [
        {
          "id":1,
          "enabled":false,
          "singleTimer": {"startDateTime":"1999-12-31T23:00:00Z"}
        },
        {
          "id":2,
          "enabled":false,
          "singleTimer": {"startDateTime":"1999-12-31T23:00:00Z"}
        }
      ],
      "carCapturedTimestamp":"2021-02-13T10:37:17.203Z",
      "timeInCar":"2021-02-13T11:37:17+01:00"
    },
    "windowHeatingStatus": {
      "carCapturedTimestamp":"2021-02-13T10:38:03Z",
      "windowHeatingStatus": [
        {
        "windowLocation":"front", "windowHeatingState":"off"
        },
        {
        "windowLocation":"rear", "windowHeatingState":"off"
        }
      ]
    },
    "rangeStatus": {
      "carCapturedTimestamp":"2021-02-13T10:38:00Z",
      "carType":"electric",
      "primaryEngine": {
        "type":"electric",
        "currentSOC_pct":67,
        "remainingRange_km":199
      },
      "totalRange_km":199
    },
    "capabilityStatus": {
      "capabilities": [
        {"id":"access", "status":[1008], "userDisablingAllowed":false },
        {"id":"automation", "expirationDate":"2024-01-11T00:00:00Z", "userDisablingAllowed":true},
        {"id":"charging","expirationDate":"2024-01-11T00:00:00Z","userDisablingAllowed":true},
        {"id":"chargingStations","status":[4001],"expirationDate":"2024-01-11T00:00:00Z","userDisablingAllowed":true},
        {"id":"climatisation","expirationDate":"2024-01-11T00:00:00Z","userDisablingAllowed":true},
        {"id":"destinations","expirationDate":"2024-01-11T00:00:00Z","userDisablingAllowed":true},
        {"id":"fuelStatus","userDisablingAllowed":false},
        {"id":"ignition","status":[1008],"userDisablingAllowed":false},
        {"id":"mapUpdate","status":[4001],"expirationDate":"2024-01-11T00:00:00Z","userDisablingAllowed":true},
        {"id":"measurements","status":[1008],"userDisablingAllowed":false},
        {"id":"onlineSpeech","expirationDate":"2024-01-11T00:00:00Z","userDisablingAllowed":true},
        {"id":"parkingPosition","status":[1008],"userDisablingAllowed":false},
        {"id":"routing","expirationDate":"2024-01-11T00:00:00Z","userDisablingAllowed":true},
        {"id":"state","status":[1008],"userDisablingAllowed":false},
        {"id":"trafficInformation","status":[4001],"expirationDate":"2024-01-11T00:00:00Z","userDisablingAllowed":true},
        {"id":"vehicleLights","status":[1008],"userDisablingAllowed":false},
        {"id":"webRadio","expirationDate":"2024-01-11T00:00:00Z","userDisablingAllowed":true}
      ]
    }
  },
  "error": {}
}
```

#### vwConn.carData - Car data for all others? Can't test it.
