# npm-vwconnectapi
NPM package for a VW Connect API based on https://github.com/TA2k/ioBroker.vw-connect


Example:

const api = require('npm-vwconnectapi');

var log = new api.Log();

var vwConn = new api.VwWeConnect();

vwConn.setCredentials("YourEmail", "YourPassword", "YourPin");

vwConn.setConfig("id"); // type

vwConn.onReady()


Objects supplied by the API:
vwConn.vehicles - List of vehicles
vwConn.stations - List of wallboxes
vwConn.homechargingRecords - Charging records of the wallbox
vwConn.IdData - Car data for the IDs
vwConn.carData - Car data for all others? Can't test it.
