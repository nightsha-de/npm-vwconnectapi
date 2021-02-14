# npm-vwconnectapi
NPM package for a VW Connect API based on https://github.com/TA2k/ioBroker.vw-connect


### Example:

const api = require('npm-vwconnectapi');

var log = new api.Log();

var vwConn = new api.VwWeConnect();

vwConn.setCredentials("YourEmail", "YourPassword", "YourPin");

vwConn.setConfig("id"); // type

vwConn.onReady()


### Objects supplied by the API:

#### vwConn.vehicles - List of vehicles

#### vwConn.stations - List of wallboxes

#### vwConn.homechargingRecords - Charging records of the wallbox
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
#### vwConn.IdData - Car data for the IDs

#### vwConn.carData - Car data for all others? Can't test it.
