# npm-vwconnectapi
NPM package for a VW Connect API based on https://github.com/TA2k/ioBroker.vw-connect

Clone this repository to $path and use
```
sudo npm install -g $path
```
to install.

### Example code:

```javascript
const api = require('npm-vwconnectapi');
var log = new api.Log();
var vwConn = new api.VwWeConnect();
vwConn.setLogLevel("INFO"); // optional, ERROR (default), INFO, WARN or DEBUG
vwConn.setCredentials("YourEmail", "YourPassword", "YourPin");
vwConn.setConfig("id"); // type
vwConn.setHistoryLimit(20); // optional: max number of charging records to receive, default 100
vwConn.getData()
  .then(() => {
    log.info("SOC " + vwConn.idData.data.batteryStatus.currentSOC_pct + "%");

    vwConn.setActiveVin("the VIN of your ID"); // must exist in vwConn.vehicles
    //vwConn.startClimatisation(17).then(...)
    //vwConn.stopClimatisation().then(...)
    //vwConn.stopCharging().then(...)
    vwConn.startCharging()
      .then(() => {
        log.info("Charging started");
      })
      .catch(() => {
        log.error("Error while starting the charging");
      })
      .finally(() => {
        log.info("Exiting ...");
        vwConn.onUnload();
        process.exit(1);
      });
  })
  .catch(() => {
    log.error("something went wrong");
    process.exit(1);
  });
```

### Methods supplied by the API:
All methods work with promises.

#### vwConn.setCredentials(user, password, pin)
Login credentials. Pin is not needed for the ID connect, but probably for other car types.

#### vwConn.setConfig(type)
Set the config type. "id" for the ID series. Other possible values "vw", "skoda", "skodae", "seat", "audi", "vwv2" and "go". "seatelli" for Seat/Elli wallbox.

#### vwConn.setLogLevel(logLevel)
Set/change the log level to "DEBUG", "INFO" or "ERROR" (default).

#### vwConn.getData()
Fills all data objects. If the process is not explicitly exited after getData (see example) it will regularly update the data in a given interval.

#### vwConn.setActiveVin(VIN)
Sets the VIN that is used for climatisation and charging. Setting is mandatory before clima or charging actions, VIN needs to exists in the vwConn.vehicles data.

#### vwConn.startClimatisation(temperature)
Start the air-conditioning with the given temperature.

#### vwConn.stopClimatisation()
Stop the air-conditioning.

#### vwConn.setTargetSOC(targetSOC)
Change the target SOC for charging.

#### vwConn.startCharging()
Start charging.

#### vwConn.stopCharging()
Stop charging.

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

#### vwConn.chargeAndPay - Charging records from WeCharge subscriptions
```
[
{
  "id":"99c0a332-3243-47c4-1234-b1a4d12342-1234243,
  “subscription_id":"1899c83f-e5db-49d0-9aba-396328363“,
  “location_evse_id":"DE*HLG*E123456*5“,
  “location_name“:“some location name“,
  “location_address“:“some location address“,
  “location_connector_power_type":"AC_3_PHASE",
  "location_coordinates_latitude":"52.12345",
  "location_coordinates_longitude“:“9.123456",
  "currency":"EUR",
  "total_energy":0.333,
  "total_price":0.105,
  "total_time":235,
  "created_at":"2021-03-07T15:15:15.166Z",
  "updated_at":"2021-03-07T15:15:15.734Z",
  "end_date_time":"2021-03-07T15:15:10.000Z",
  "start_date_time":"2021-03-07T15:11:15.000Z",
  "timezone":"Europe/Berlin"
},
{
...more records...
}
]
```

#### vwConn.idData - Car data for the IDs
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
#### vwConn.skodaEData - Car data for Skoda MEB based cars (type "skodae")
tbd - anyone with an electric Skoda please fill in the structure :)

#### vwConn.carData - Car data for all others? Can't test it.
