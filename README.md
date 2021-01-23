# npm-vwconnectapi
NPM package for a VW Connect API based on https://github.com/TA2k/ioBroker.vw-connect


Example:

const api = require('npm-vwconnectapi');
var log = new api.Log();
var vwConn = new api.VwWeConnect();
vwConn.setCredentials("YourEmail", "YourPassword", "YourPin");
vwConn.setConfig("id"); // type
vwConn.onReady()
