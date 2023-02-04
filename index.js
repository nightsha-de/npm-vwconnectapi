"use strict";

// latest checked version of ioBroker.vw-connect: latest // https://github.com/TA2k/ioBroker.vw-connect/commit/f6d3cd10916c1704b4201a0598e2ecd5a0db3c62

const request = require("request");
const qs = require("qs");
const crypto = require("crypto");
const { Crypto } = require("@peculiar/webcrypto");
const { v4: uuidv4 } = require("uuid");
const traverse = require("traverse");
const geohash = require("ngeohash");
const axios = require("axios").default;
const Json2iob = require("./lib/json2iob");

class Log {
  constructor(logLevel) {
    this.logLevel = logLevel;
    this.debug("Start logging instance");
  }

  setLogLevel(pLogLevel) {
      this.logLevel = pLogLevel;
  }

  debug(pMessage) {
    if (this.logLevel == "DEBUG")
    {
      console.log("DEBUG: " + pMessage);
    }
  }

  error(pMessage) {
    console.log("ERROR: " + pMessage);
  }

  info(pMessage) {
    if (this.logLevel == "DEBUG" || this.logLevel == "INFO")
    {
      console.log("INFO:  " + pMessage);
    }
  }

  warn(pMessage) {
    if (this.logLevel == "DEBUG" || this.logLevel == "INFO" || this.logLevel == "WARN")
    {
      console.log("WARN: " + pMessage);
    }
  }
}

class VwWeConnect {
    config = {
        userid: 0,
        user: "testuser",
        password: "testpass",
        pin: "123",
        type: "id",
        interval: 10,
        forceinterval: 0,
        numberOfTrips: 1,
        logLevel: "ERROR",
        targetTempC: -1,
        targetSOC: -1,
        chargerOnly: false
    }

    currSession = {
        vin: "n/a"
    }

    constructor() {
        this.boolFinishIdData = false;
        this.boolFinishHomecharging = false;
        this.boolFinishChargeAndPay = false;
        this.boolFinishStations = false;
        this.boolFinishVehicles = false;
        this.boolFinishCarData = false;

        this.log = new Log(this.config.logLevel);
        this.jar = request.jar();

        this.refreshTokenInterval = null;
        this.vwrefreshTokenInterval = null;
        this.updateInterval = null;
        this.fupdateInterval = 0; // set force update interval to 0 => deactivated;
        this.refreshTokenTimeout = null;

        this.homeRegion = {};
        this.homeRegionSetter = {};
        this.secondAcessToken = null;

        this.vinArray = [];
        this.etags = {};
        this.hasRemoteLock = false;
        this.isFirstLocation = true;

        this.statesArray = [
            {
                url: "$homeregion/fs-car/bs/departuretimer/v1/$type/$country/vehicles/$vin/timer",
                path: "timer",
                element: "timer",
            },
            {
                url: "$homeregion/fs-car/bs/climatisation/v1/$type/$country/vehicles/$vin/climater",
                path: "climater",
                element: "climater",
            },
            {
                url: "$homeregion/fs-car/bs/cf/v1/$type/$country/vehicles/$vin/position",
                path: "position",
                element: "storedPositionResponse",
                element2: "position",
                element3: "findCarResponse",
                element4: "Position",
            },
            {
                url: "$homeregion/fs-car/bs/tripstatistics/v1/$type/$country/vehicles/$vin/tripdata/$tripType?type=list",
                path: "tripdata",
                element: "tripDataList",
            },
            {
                url: "$homeregion/fs-car/bs/vsr/v1/$type/$country/vehicles/$vin/status",
                path: "status",
                element: "StoredVehicleDataResponse",
                element2: "vehicleData",
            },
            {
                url: "$homeregion/fs-car/destinationfeedservice/mydestinations/v1/$type/$country/vehicles/$vin/destinations",
                path: "destinations",
                element: "destinations",
            },
            {
                url: "$homeregion/fs-car/bs/batterycharge/v1/$type/$country/vehicles/$vin/charger",
                path: "charger",
                element: "charger",
            },
            {
                url: "$homeregion/fs-car/bs/rs/v1/$type/$country/vehicles/$vin/status",
                path: "remoteStandheizung",
                element: "statusResponse",
            },
            {
                url: "$homeregion/fs-car/bs/dwap/v1/$type/$country/vehicles/$vin/history",
                path: "history",
            },
        ];
    }

    finishedReading() {
      this.log.debug(" Id: " + this.boolFinishIdData +
                     " HomeCharge: " + this.boolFinishHomecharging +
                     " ChargePay: " + this.boolFinishChargeAndPay +
                     " Stat: " + this.boolFinishStations +
                     /*" Car: " + this.boolFinishCarData*/
                     " Vehic: " + this.boolFinishVehicles);
      return (this.boolFinishIdData || this.config.chargerOnly)
          && this.boolFinishHomecharging
          && this.boolFinishChargeAndPay
          && this.boolFinishStations
          /*&& this.boolFinishCarData*/
          && this.boolFinishVehicles;
    }

    setCredentials(pUser, pPass, pPin) {
        //this.config.userid = 0;
        this.config.user = pUser;
        this.config.password = pPass;
        this.config.pin = pPin;
        //this.config.type = "id";
        //this.config.interval = 10;
        //this.config.forceinterval = 360; // shouldn't be smaller than 360mins, default 0 (off)
        //this.config.numberOfTrips = 1;
    }

    setConfig(pType) {
        if (pType == "idCharger")
        {
          this.config.type = "id";
          this.config.chargerOnly = true;
        }
        else
        {
          this.config.type = pType;
        }
    }

    setActiveVin(pVin) {
        if (this.vinArray.includes(pVin)) {
            this.currSession.vin = pVin;
            this.log.info("Active VIN successfully set to <" + this.currSession.vin + ">.");
        } else {
            this.log.error("VIN <" + pVin + "> is unknown. Active VIN is still <" + this.currSession.vin + ">.");
        }
    }

    stopCharging() {
      return new Promise(async (resolve, reject) => {
        this.log.debug("stopCharging >>");
        this.setIdRemote(this.currSession.vin, "charging", "stop", "")
          .then(() => {
            this.log.debug("stopCharging successful");
            resolve();
            return;
          })
          .catch(() => {
            this.log.error("stopCharging failed");
            reject();
            return;
          });
        this.log.debug("stopCharging <<");
      });
    }

    setTargetSOC(pTargetSOC) {
      return new Promise(async (resolve, reject) => {
        this.log.debug("setTargetSOC to " + pTargetSOC + "% >>");
        if (!this.finishedReading()) {
            this.log.info("Reading necessary data not finished yet. Please try again.");
            reject();
            return;
        }
        if (!this.vinArray.includes(this.currSession.vin)) {
            this.log.error("Unknown VIN, aborting. Use setActiveVin to set a valid VIN.");
            reject();
            return;
        }
        this.config.targetSOC = pTargetSOC;

        this.setIdRemote(this.currSession.vin, "charging", "settings")
          .then(() => {
              this.log.info("Target SOC set to " + this.config.targetSOC + "%.");
              resolve();
              return;
          })
          .catch(() => {
                this.log.error("setting SOC failed");
                reject();
                return;
          });
        this.log.debug("setTargetSOC <<");
      });
    }

    startCharging() {
      return new Promise(async (resolve, reject) => {
        this.log.debug("startCharging >>");
        if (!this.finishedReading()) {
            this.log.info("Reading necessary data not finished yet. Please try again.");
            reject();
            return;
        }
        if (!this.vinArray.includes(this.currSession.vin)) {
            this.log.error("Unknown VIN, aborting. Use setActiveVin to set a valid VIN.");
            reject();
            return;
        }

        this.setIdRemote(this.currSession.vin, "charging", "start")
          .then(() => {
            this.log.debug("startCharging successful");
            resolve();
            return;
          })
          .catch(() => {
            this.log.error("startCharging failed");
            reject();
            return;
          });

        this.log.debug("startCharging <<");
      });
    }

    stopClimatisation() {
      return new Promise(async (resolve, reject) => {
        this.log.debug("stopClimatisation >>");
        this.setIdRemote(this.currSession.vin, "climatisation", "stop", "")
          .then(() => {
            this.log.debug("stopClimatisation successful");
            resolve();
            return;
          })
          .catch(() => {
            this.log.error("stopClimatisation failed");
            reject();
            return;
          });
        this.log.debug("stopClimatisation <<");
      });
    }

    startClimatisation(pTempC) {
      return new Promise(async (resolve, reject) => {
        this.log.debug("startClimatisation with " + pTempC + "°C >>");
        if (!this.finishedReading()) {
            this.log.info("Reading necessary data not finished yet. Please try again.");
            reject();
            return;
        }
        if (!this.vinArray.includes(this.currSession.vin)) {
            this.log.error("Unknown VIN, aborting. Use setActiveVin to set a valid VIN.");
            reject();
            return;
        }
        if (pTempC < 16 || pTempC > 27) {
            this.log.info("Invalid temperature, setting 20°C as default");
            pTempC = 20;
        }
        this.config.targetTempC = pTempC;

        this.setIdRemote(this.currSession.vin, "climatisation", "start", "")
          .then(() => {
            this.log.debug("startClimatisation successful");
            resolve();
            return;
          })
          .catch(() => {
            this.log.error("startClimatisation failed");
            reject();
            return;
          });
        this.log.debug("startClimatisation <<");
      });
    }

    // logLevel: ERROR, INFO, DEBUG
    setLogLevel(pLogLevel) {
      this.log.setLogLevel(pLogLevel);
    }

    async getData() {
        this.boolFinishIdData = false;
        this.boolFinishHomecharging = false;
        this.boolFinishChargeAndPay = false;
        this.boolFinishStations = false;
        this.boolFinishVehicles = false;
        this.boolFinishCarData = false;

        // resolve only after all the different calls have finished reading their data
        // await promise at the end of this method
        let promise = new Promise((resolve, reject) => {
            const finishedReadingInterval = setInterval(() => {
                if (this.finishedReading())
                {
                    clearInterval(finishedReadingInterval)
                    resolve("done!");
                }
            }, 1000)
        });

        // Reset the connection indicator during startup
        this.type = "VW";
        this.country = "DE";
        this.clientId = "9496332b-ea03-4091-a224-8c746b885068%40apps_vw-dilab_com";
        this.xclientId = "38761134-34d0-41f3-9a73-c4be88d7d337";
        this.scope = "openid%20profile%20mbb%20email%20cars%20birthdate%20badge%20address%20vin";
        this.redirect = "carnet%3A%2F%2Fidentity-kit%2Flogin";
        this.xrequest = "de.volkswagen.carnet.eu.eremote";
        this.responseType = "id_token%20token%20code";
        this.xappversion = "5.1.2";
        this.xappname = "eRemote";
        if (this.config.type === "id") {
            this.type = "Id";
            this.country = "DE";
            this.clientId = "a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com";
            this.xclientId = "";
            this.scope = "openid profile badge cars dealers birthdate vin";
            this.redirect = "weconnect://authenticated";
            this.xrequest = "com.volkswagen.weconnect";
            this.responseType = "code id_token token";
            this.xappversion = "";
            this.xappname = "";
        }
        if (this.config.type === "skoda") {
            this.type = "Skoda";
            this.country = "CZ";
            this.clientId = "f9a2359a-b776-46d9-bd0c-db1904343117@apps_vw-dilab_com";
            this.xclientId = "afb0473b-6d82-42b8-bfea-cead338c46ef";
            this.scope = "openid mbb profile";
            this.redirect = "skodaconnect://oidc.login/";
            this.xrequest = "cz.skodaauto.connect";
            this.responseType = "code%20id_token";
      this.xappversion = "3.2.6";
      this.xappname = "cz.skodaauto.connect";
    }
    if (this.config.type === "skodae") {
            this.type = "Skoda";
            this.country = "CZ";
            this.clientId = "f9a2359a-b776-46d9-bd0c-db1904343117@apps_vw-dilab_com";
            this.xclientId = "afb0473b-6d82-42b8-bfea-cead338c46ef";
            this.scope = "openid mbb profile";
            this.redirect = "skodaconnect://oidc.login/";
            this.xrequest = "cz.skodaauto.connect";
            this.responseType = "code%20id_token%20token";
            this.xappversion = "3.2.6";
            this.xappname = "cz.skodaauto.connect";
        }
        if (this.config.type === "seat") {
            this.type = "Seat";
            this.country = "ES";
            this.clientId = "50f215ac-4444-4230-9fb1-fe15cd1a9bcc@apps_vw-dilab_com";
            this.xclientId = "9dcc70f0-8e79-423a-a3fa-4065d99088b4";
            this.scope = "openid profile mbb cars birthdate nickname address phone";
            this.redirect = "seatconnect://identity-kit/login";
            this.xrequest = "cz.skodaauto.connect";
            this.responseType = "code%20id_token";
            this.xappversion = "1.1.29";
            this.xappname = "SEATConnect";
        }
        if (this.config.type === "seatcupra") {
            this.type = "Seat";
            this.clientId = "3c756d46-f1ba-4d78-9f9a-cff0d5292d51@apps_vw-dilab_com";
            this.scope = "openid profile nickname birthdate phone";
            this.redirect = "cupra://oauth-callback";
            this.responseType = "code";
            this.xappversion = "1.1.29";
            this.xappname = "SEATConnect";
        }
        if (this.config.type === "vwv2") {
            this.type = "VW";
            this.country = "DE";
            this.clientId = "9496332b-ea03-4091-a224-8c746b885068@apps_vw-dilab_com";
            this.xclientId = "89312f5d-b853-4965-a471-b0859ee468af";
            this.scope = "openid profile mbb cars birthdate nickname address phone";
            this.redirect = "carnet://identity-kit/login";
            this.xrequest = "de.volkswagen.car-net.eu.e-remote";
            this.responseType = "id_token%20token%20code";
            this.xappversion = "5.6.7";
            this.xappname = "We Connect";
        }
        if (this.config.type === "audi") {
            this.type = "Audi";
            this.country = "DE";
            this.clientId = "09b6cbec-cd19-4589-82fd-363dfa8c24da@apps_vw-dilab_com";
            this.xclientId = "77869e21-e30a-4a92-b016-48ab7d3db1d8";
            this.scope = "address profile badge birthdate birthplace nationalIdentifier nationality profession email vin phone nickname name picture mbb gallery openid";
            this.redirect = "myaudi:///";
            this.xrequest = "de.myaudi.mobile.assistant";
            this.responseType = "token%20id_token";
            // this.responseType = "code";
            this.xappversion = "3.22.0";
            this.xappname = "myAudi";
        }
        if (this.config.type === "audietron") {
          this.type = "Audi";
          this.country = "DE";
          this.clientId = "f4d0934f-32bf-4ce4-b3c4-699a7049ad26@apps_vw-dilab_com";
          this.scope =
            "address badge birthdate birthplace email gallery mbb name nationalIdentifier nationality nickname phone picture profession profile vin openid";
          this.redirect = "myaudi:///";
          this.responseType = "code";
          this.xappversion = "3.22.0";
          this.xappname = "myAudi";
        }
        if (this.config.type === "audidata") {
          this.type = "Audi";
          this.country = "DE";
          this.clientId = "ec6198b1-b31e-41ec-9a69-95d42d6497ed@apps_vw-dilab_com";
          this.scope = "openid profile address email phone";
          this.redirect = "acpp://de.audi.connectplugandplay/oauth2redirect/identitykit";
          this.responseType = "code";
        }
        if (this.config.type === "go") {
            this.type = "";
            this.country = "";
            this.clientId = "ac42b0fa-3b11-48a0-a941-43a399e7ef84@apps_vw-dilab_com";
            this.xclientId = "";
            this.scope = "openid%20profile%20address%20email%20phone";
            this.redirect = "vwconnect%3A%2F%2Fde.volkswagen.vwconnect%2Foauth2redirect%2Fidentitykit";
            this.xrequest = "";
            this.responseType = "code";
            this.xappversion = "";
            this.xappname = "";
        }
        if (this.config.type === "seatelli") {
          this.type = "";
          this.country = "";
          this.clientId = "d940d794-5945-48a3-84b1-44222c387800@apps_vw-dilab_com";
          this.xclientId = "";
          this.scope = "openid profile";
          this.redirect = "Seat-elli-hub://opid";
          this.xrequest = "";
          this.responseType = "code";
          this.xappversion = "";
          this.xappname = "";
        }
        if (this.config.type === "skodapower") {
          this.type = "";
          this.country = "";
          this.clientId = "b84ba8a1-7925-43c9-9963-022587faaac5@apps_vw-dilab_com";
          this.xclientId = "";
          this.scope = "openid profile";
          this.redirect = "skoda-hub://opid";
          this.xrequest = "";
          this.responseType = "code";
          this.xappversion = "";
          this.xappname = "";
        }
        if (!this.config.interval || this.config.interval < 0.5) {
            this.log.info("Interval of 0 is not allowed reset to 1");
            this.config.interval = 1;
        }
        this.tripTypes = [];
        if (this.config.tripShortTerm == true) {
            this.tripTypes.push("shortTerm");
        }
        if (this.config.tripLongTerm == true) {
            this.tripTypes.push("longTerm");
        }
        if (this.config.tripCyclic == true) {
            this.tripTypes.push("cyclic");
        }
        this.login()
            .then(() => {
                this.log.debug("Login successful");
                this.getPersonalData()
                    .then(() => {
                        this.getVehicles()
                            .then(() => {
                                if (this.config.type !== "go") {
                                    this.vinArray.forEach((vin) => {
                                        if (this.config.type === "id" || this.config.type === "audietron") {
                                          this.getIdStatus(vin).catch(() => {
                                              this.log.error("get id status Failed");
                                          });
                                        } else if (this.config.type === "seatcupra") {
                                          this.getSeatCupraStatus(vin).catch(() => {
                                            this.log.error("get cupra status Failed");
                                          });
                                        } else if (this.config.type === "audidata") {
                                          this.getAudiDataStatus(vin).catch(() => {
                                            this.log.error("get audi data status Failed");
                                          });
                                        } else if (this.config.type === "skodae") {
                                          this.clientId = "7f045eee-7003-4379-9968-9355ed2adb06%40apps_vw-dilab_com";
                                          this.scope = "openid dealers profile email cars address";
                                          this.redirect = "skodaconnect://oidc.login/";

                                          this.login()
                                            .then(() => {
                                              this.getSkodaEStatus(vin);
                                            })
                                            .catch(() => {
                                              this.log.error("Failed second skoda login");
                                            });
                                        } else {
                                            this.getHomeRegion(vin)
                                                .catch(() => {
                                                    this.log.debug("get home region Failed " + vin);
                                                })
                                                .finally(() => {
                                                    this.getVehicleData(vin).catch(() => {
                                                        this.log.error("get vehicle data Failed");
                                                    });
                                                    this.getVehicleRights(vin).catch(() => {
                                                        this.log.error("get vehicle rights Failed");
                                                    });
                                                    this.requestStatusUpdate(vin)
                                                        .finally(() => {
                                                            this.statesArray.forEach((state) => {
                                                                if (state.path == "tripdata") {
                                                                    this.tripTypes.forEach((tripType) => {
                                                                        this.getVehicleStatus(
                                                                            vin,
                                                                            state.url,
                                                                            state.path,
                                                                            state.element,
                                                                            state.element2,
                                                                            state.element3,
                                                                            state.element4,
                                                                            tripType
                                                                        ).catch(() => {
                                                                            this.log.debug("error while getting " + state.url);
                                                                        });
                                                                    });
                                                                } else {
                                                                      this.getVehicleStatus(
                                                                        vin,
                                                                        state.url,
                                                                        state.path,
                                                                        state.element,
                                                                        state.element2,
                                                                        state.element3,
                                                                        state.element4,
                                                                      ).catch(() => {
                                                                        this.log.debug("error while getting " + state.url);
                                                                    });
                                                                }
                                                            });
                                                        })
                                                        .catch(() => {
                                                            this.log.error("status update Failed " + vin);
                                                        });
                                                })
                                                .catch(() => {
                                                    this.log.error("Error getting home region");
                                                });
                                        }
                                    });
                                }

                                this.updateInterval = setInterval(() => {
                                    if (this.config.type === "go") {
                                        this.getVehicles();
                                        return;
                                    } else if (this.config.type === "id") {
                                        this.vinArray.forEach((vin) => {
                                            this.getIdStatus(vin).catch(() => {
                                                this.log.error("get id status Failed");
                                                this.refreshIDToken().catch(() => {});
                                            });
                                            this.getWcData();
                                        });
                                        return;
                                    } else {
                                        this.vinArray.forEach((vin) => {
                                            this.statesArray.forEach((state) => {
                                                if (state.path == "tripdata") {
                                                    this.tripTypes.forEach((tripType) => {
                                                        this.getVehicleStatus(vin, state.url, state.path, state.element, state.element2, null, null, tripType).catch(() => {
                                                            this.log.debug("error while getting " + state.url);
                                                        });
                                                    });
                                                } else {
                                                    this.getVehicleStatus(vin, state.url, state.path, state.element, state.element2).catch(() => {
                                                        this.log.debug("error while getting " + state.url);
                                                    });
                                                }

                                            });
                                        });
                                    }
                                }, this.config.interval * 60 * 1000);

                                if (this.config.type !== "id") {
                                    if (this.config.forceinterval > 0) {
                                        this.fupdateInterval = setInterval(() => {
                                            if (this.config.type === "go") {
                                                this.getVehicles();
                                                return;
                                            }
                                            this.vinArray.forEach((vin) => {
                                                this.requestStatusUpdate(vin).catch(() => {
                                                    this.log.error("force status update Failed");
                                                });
                                            });
                                        }, this.config.forceinterval * 60 * 1000);
                                    }
                                }
                            })
                            .catch(() => {
                                this.log.error("Get Vehicles Failed");
                            });
                    })
                    .catch(() => {
                        this.log.error("get personal data Failed");
                    });
            })
            .catch(() => {
                this.log.error("Login Failed");
            });

        let result = await promise; // wait for the promise from the start to resolve
        this.log.debug("getData END");
    }

    login() {
        return new Promise(async (resolve, reject) => {
            const nonce = this.getNonce();
            const state = uuidv4();

      let [code_verifier, codeChallenge] = this.getCodeChallenge();
      if (this.config.type === "seatelli" || this.config.type === "skodapower") {
        [code_verifier, codeChallenge] = this.getCodeChallengev2();
      }
      const method = "GET";
      const form = {};
      let url =
        "https://identity.vwgroup.io/oidc/v1/authorize?client_id=" +
        this.clientId +
        "&scope=" +
        this.scope +
        "&response_type=" +
        this.responseType +
        "&redirect_uri=" +
        this.redirect +
        "&nonce=" +
        nonce +
        "&state=" +
        state;
      if (
        this.config.type === "vw" ||
        this.config.type === "vwv2" ||
        this.config.type === "go" ||
        this.config.type === "seatelli" ||
        this.config.type === "skodapower" ||
        this.config.type === "audidata" ||
        this.config.type === "audietron" ||
        this.config.type === "seatcupra"
      ) {
        url += "&code_challenge=" + codeChallenge + "&code_challenge_method=S256";
      }
      if (this.config.type === "audi") {
        url += "&ui_locales=de-DE%20de&prompt=login";
      }
      if (this.config.type === "id" && this.type !== "Wc") {
        url = await this.receiveLoginUrl().catch(() => {
          this.log.warn("Failed to get login url");
        });
        if (!url) {
          url =
            "https://login.apps.emea.vwapps.io/authorize?nonce=" +
            this.randomString(16) +
            "&redirect_uri=weconnect://authenticated";
        }
      }
      const loginRequest = request(
        {
          method: method,
          url: url,
          headers: {
            "User-Agent": this.userAgent,
            Accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
            "Accept-Language": "en-US,en;q=0.9",
            "Accept-Encoding": "gzip, deflate",
            "x-requested-with": this.xrequest,
            "upgrade-insecure-requests": 1,
          },
          jar: this.jar,
          form: form,
          gzip: true,
          followAllRedirects: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            if (this.type === "Wc") {
              if (err && err.message && err.message === "Invalid protocol: wecharge:") {
                this.log.debug("Found WeCharge connection");
                this.getTokens(loginRequest, code_verifier, reject, resolve);
              } else {
                this.log.debug("No WeCharge found, cancel login");
                resolve();
              }
              return;
            }
            if (err && err.message && err.message.indexOf("Invalid protocol:") !== -1) {
              this.log.debug("Found Token");
              this.getTokens(loginRequest, code_verifier, reject, resolve);
              return;
            }
            this.log.error("Failed in first login step ");
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            body && this.log.error(JSON.stringify(body));
            err && err.message && this.log.error(err.message);
            loginRequest &&
              loginRequest.uri &&
              loginRequest.uri.query &&
              this.log.debug(loginRequest.uri.query.toString());

            reject();
            return;
          }

          try {
            let form = {};
            if (body.indexOf("emailPasswordForm") !== -1) {
              this.log.debug("parseEmailForm");
              form = this.extractHidden(body);
              form["email"] = this.config.user;
            } else {
              if (this.type === "Wc") {
                resolve();
                return;
              }
              this.log.error("No Login Form found for type: " + this.type);
              this.log.debug(JSON.stringify(body));
              reject();
              return;
            }
            request.post(
              {
                url: "https://identity.vwgroup.io/signin-service/v1/" + this.clientId + "/login/identifier",
                headers: {
                  "Content-Type": "application/x-www-form-urlencoded",
                  "User-Agent": this.userAgent,
                  Accept:
                    "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
                  "Accept-Language": "en-US,en;q=0.9",
                  "Accept-Encoding": "gzip, deflate",
                  "x-requested-with": this.xrequest,
                },
                form: form,
                jar: this.jar,
                gzip: true,
                followAllRedirects: true,
              },
              (err, resp, body) => {
                if (err || (resp && resp.statusCode >= 400)) {
                  this.log.error("Failed to get login identifier");
                  err && this.log.error(err);
                  resp && this.log.error(resp.statusCode.toString());
                  body && this.log.error(JSON.stringify(body));
                  reject();
                  return;
                }
                try {
                  if (body.indexOf("emailPasswordForm") !== -1) {
                    this.log.debug("emailPasswordForm2");

                    /*
                                        const stringJson =body.split("window._IDK = ")[1].split(";")[0].replace(/\n/g, "")
                                        const json =stringJson.replace(/(['"])?([a-z0-9A-Z_]+)(['"])?:/g, '"$2": ').replace(/'/g, '"')
                                        const jsonObj = JSON.parse(json);
                                        */
                    form = {
                      _csrf: body.split("csrf_token: '")[1].split("'")[0],
                      email: this.config.user,
                      password: this.config.password,
                      hmac: body.split('"hmac":"')[1].split('"')[0],
                      relayState: body.split('"relayState":"')[1].split('"')[0],
                    };
                  } else {
                    this.log.error("No Login Form found. Please check your E-Mail in the app.");
                    this.log.debug(JSON.stringify(body));
                    reject();
                    return;
                  }
                  request.post(
                    {
                      url: "https://identity.vwgroup.io/signin-service/v1/" + this.clientId + "/login/authenticate",
                      headers: {
                        "Content-Type": "application/x-www-form-urlencoded",
                        "User-Agent": this.userAgent,
                        Accept:
                          "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
                        "Accept-Language": "en-US,en;q=0.9",
                        "Accept-Encoding": "gzip, deflate",
                        "x-requested-with": this.xrequest,
                      },
                      form: form,
                      jar: this.jar,
                      gzip: true,
                      followAllRedirects: false,
                    },
                    (err, resp, body) => {
                      if (err || (resp && resp.statusCode >= 400)) {
                        this.log.error("Failed to get login authenticate");
                        err && this.log.error(err);
                        resp && this.log.error(resp.statusCode.toString());
                        body && this.log.error(JSON.stringify(body));
                        reject();
                        return;
                      }

                      try {
                        this.log.debug(JSON.stringify(body));
                        this.log.debug(JSON.stringify(resp.headers));

                        if (
                          resp.headers.location.split("&").length <= 2 ||
                          resp.headers.location.indexOf("/terms-and-conditions?") !== -1
                        ) {
                          this.log.warn(resp.headers.location);
                          this.log.warn(
                            "No valid userid, please check username and password or visit this link or logout and login in your app account:",
                          );
                          this.log.warn("https://" + resp.request.host + resp.headers.location);
                          this.log.warn("Try to auto accept new consent");

                          request.get(
                            {
                              url: "https://" + resp.request.host + resp.headers.location,
                              jar: this.jar,
                              headers: {
                                "User-Agent": this.userAgent,
                                Accept:
                                  "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
                                "Accept-Language": "en-US,en;q=0.9",
                                "Accept-Encoding": "gzip, deflate",
                                "x-requested-with": this.xrequest,
                              },
                              followAllRedirects: true,
                              gzip: true,
                            },
                            (err, resp, body) => {
                              this.log.debug(body);

                              const form = this.extractHidden(body);
                              const url = "https://" + resp.request.host + resp.req.path.split("?")[0];
                              this.log.debug(JSON.stringify(form));
                              request.post(
                                {
                                  url: url,
                                  jar: this.jar,
                                  headers: {
                                    "Content-Type": "application/x-www-form-urlencoded",
                                    "User-Agent": this.userAgent,
                                    Accept:
                                      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
                                    "Accept-Language": "en-US,en;q=0.9",
                                    "Accept-Encoding": "gzip, deflate",
                                    "x-requested-with": this.xrequest,
                                  },
                                  form: form,
                                  followAllRedirects: true,
                                  gzip: true,
                                },
                                (err, resp, body) => {
                                  if (
                                    (err && err.message.indexOf("Invalid protocol:") !== -1) ||
                                    (resp && resp.statusCode >= 400)
                                  ) {
                                    this.log.warn("Failed to auto accept");
                                    err && this.log.error(err);
                                    resp && this.log.error(resp.statusCode.toString());
                                    body && this.log.error(JSON.stringify(body));
                                    reject();
                                    return;
                                  }
                                  this.log.info("Auto accept succesful. Restart adapter in 10sec");
                                  setTimeout(() => {
                                    this.restart();
                                  }, 10 * 1000);
                                },
                              );
                            },
                          );

                          reject();
                          return;
                        }
                        this.config.userid = resp.headers.location.split("&")[2].split("=")[1];
                        if (!this.stringIsAValidUrl(resp.headers.location)) {
                          if (resp.headers.location.indexOf("&error=") !== -1) {
                            const location = resp.headers.location;
                            this.log.error(
                              "Error: " + location.substring(location.indexOf("error="), location.length - 1),
                            );
                          } else {
                            this.log.error("No valid login url, please download the log and visit:");
                            this.log.error("http://" + resp.request.host + resp.headers.location);
                          }
                          reject();
                          return;
                        }

                        let getRequest = request.get(
                          {
                            url: resp.headers.location || "",
                            headers: {
                              "User-Agent": this.userAgent,
                              Accept:
                                "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
                              "Accept-Language": "en-US,en;q=0.9",
                              "Accept-Encoding": "gzip, deflate",
                              "x-requested-with": this.xrequest,
                            },
                            jar: this.jar,
                            gzip: true,
                            followAllRedirects: true,
                          },
                          (err, resp, body) => {
                            if (err) {
                              this.log.debug(err);
                              this.getTokens(getRequest, code_verifier, reject, resolve);
                            } else {
                              this.log.debug(body);
                              this.log.debug("No Token received visiting url and accept the permissions.");
                              const form = this.extractHidden(body);
                              getRequest = request.post(
                                {
                                  url: getRequest.uri.href,
                                  headers: {
                                    "Content-Type": "application/x-www-form-urlencoded",
                                    "User-Agent": this.userAgent,
                                    Accept:
                                      "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3",
                                    "Accept-Language": "en-US,en;q=0.9",
                                    "Accept-Encoding": "gzip, deflate",
                                    "x-requested-with": this.xrequest,
                                    referer: getRequest.uri.href,
                                  },
                                  form: form,
                                  jar: this.jar,
                                  gzip: true,
                                  followAllRedirects: true,
                                },
                                (err, resp, body) => {
                                  if (err) {
                                    this.getTokens(getRequest, code_verifier, reject, resolve);
                                  } else {
                                    this.log.error(
                                      "No Token received. Please try to logout and login in the VW app or select type VWv2 in the settings",
                                    );
                                    try {
                                      this.log.debug(JSON.stringify(body));
                                    } catch (err) {
                                      this.log.error(err);
                                      reject();
                                    }
                                  }
                                },
                              );
                            }
                          },
                        );
                      } catch (err2) {
                        this.log.error(
                          "Login was not successful, please check your login credentials and selected type",
                        );
                        err && this.log.error(err);
                        this.log.error(err2);
                        this.log.error(err2.stack);
                        reject();
                      }
                    },
                  );
                } catch (err) {
                  this.log.error(err);
                  reject();
                }
              },
            );
          } catch (err) {
            this.log.error(err);
            reject();
          }
        },
      );
    });
  }

  receiveLoginUrl() {
    return new Promise((resolve, reject) => {
      request(
        {
          method: "GET",
          url:
            "https://login.apps.emea.vwapps.io/authorize?nonce=" +
            this.randomString(16) +
            "&redirect_uri=weconnect://authenticated",
          headers: {
            Host: "login.apps.emea.vwapps.io",
            "user-agent": this.userAgent,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "de-de",
          },
          jar: this.jar,
          gzip: true,
          followAllRedirects: false,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            this.log.error("Failed in receive login url ");
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            body && this.log.error(JSON.stringify(body));
            reject();
            return;
          }
          resolve(resp.request.href);
        },
      );
    });
  }

  replaceVarInUrl(url, vin, tripType) {
    const curHomeRegion = this.homeRegion[vin] || "https://msg.volkswagen.de";
    return url
      .replace("/$vin", "/" + vin + "")
      .replace("$homeregion/", curHomeRegion + "/")
      .replace("/$type/", "/" + this.type + "/")
      .replace("/$country/", "/" + this.country + "/")
      .replace("/$tripType", "/" + tripType);
  }
  getQmauth() {
    const timestamp = parseInt(Date.now() / 100000);
    this.log.debug(timestamp.toString());
    //credits to https://github.com/arjenvrh/audi_connect_ha/blob/master/custom_components/audiconnect/audi_services.py
    const xqmauth_secret = Buffer.from([
      256 - 28,
      120,
      102,
      55,
      256 - 114,
      256 - 16,
      101,
      256 - 116,
      256 - 25,
      93,
      113,
      0,
      122,
      256 - 128,
      256 - 97,
      52,
      97,
      107,
      256 - 106,
      53,
      256 - 30,
      256 - 20,
      34,
      256 - 126,
      69,
      120,
      76,
      31,
      99,
      256 - 24,
      256 - 115,
      6,
    ]);
    const xqmauth_val = crypto.createHmac("sha256", xqmauth_secret).update(timestamp.toString()).digest("hex");
    this.log.debug(timestamp.toString());
    return "v1:c95f4fd2:" + xqmauth_val;
  }
  getTokensv2(getRequest, code_verifier, reject, resolve) {
    const url = getRequest.uri.query;
    this.log.debug(url);
    const queries = qs.parse(url);
    const body = {
      client_id: this.clientId,
      grant_type: "authorization_code",
      code: queries.code,
      redirect_uri: "myaudi:///",
      response_type: "token id_token",
      code_verifier: code_verifier,
    };
    const qmAuth = this.getQmauth();
    this.log.debug(qmAuth);
    this.log.debug(JSON.stringify(body));

    request(
      {
        method: "POST",
        url: "https://idkproxy-service.apps.emea.vwapps.io/v1/emea/token",
        headers: {
          accept: "application/json",
          "content-type": "application/x-www-form-urlencoded; charset=utf-8",
          "accept-charset": "utf-8",
          "x-qmauth": qmAuth,
          "accept-language": "de-de",
          "user-agent": this.userAgent,
        },
        jar: this.jar,
        gzip: true,
        followAllRedirects: true,
        body: qs.stringify(body),
      },
      (err, resp) => {
        if (err || (resp && resp.statusCode >= 400)) {
          this.log.error("Failed get tokensv2. Please check your if your local time is correct");
          err && this.log.error(err);
          resp && this.log.error(resp.statusCode.toString());
          resp && resp.body && this.log.error(JSON.stringify(resp.body));
          reject();
          return;
        }
        const idktokens = JSON.parse(resp.body);
        this.config.atoken = idktokens.access_token;
        this.config.rtoken = idktokens.refresh_token;
        request(
          {
            method: "POST",
            url: "https://aazsproxy-service.apps.emea.vwapps.io/token",
            headers: {
              accept: "application/json",
              "content-type": "application/json; charset=utf-8",
              "accept-charset": "utf-8",
              "x-app-version": "4.6.0",
              "x-app-name": "myAudi",
              "accept-language": "de-de",
              "user-agent": this.userAgent,
            },
            jar: this.jar,
            gzip: true,
            followAllRedirects: false,
            body: JSON.stringify({
              token: this.config.atoken,
              grant_type: "id_token",
              stage: "live",
              config: "myaudi",
            }),
          },
          (err, resp) => {
            if (err || (resp && resp.statusCode >= 400)) {
              this.log.error("failed get audi token");
              err && this.log.error(err);
              resp && this.log.error(resp.statusCode.toString());
              body && this.log.error(JSON.stringify(body));
              reject();
              return;
            }
            this.aaztoken = JSON.parse(resp.body);
            this.refreshTokenInterval && clearInterval(this.refreshTokenInterval);
            this.refreshTokenInterval = setInterval(() => {
              this.refreshTokenv2().catch(() => {});
            }, 0.9 * 60 * 60 * 1000); // 0.9hours

            resolve();
          },
        );
      },
    );
  }
  getTokens(getRequest, code_verifier, reject, resolve) {
    if (this.config.type === "audietron") {
      this.getTokensv2(getRequest, code_verifier, reject, resolve);
      return;
    }

    let hash = "";
    if (getRequest.uri.hash) {
      hash = getRequest.uri.hash;
    } else {
      hash = getRequest.uri.query;
    }
    const hashArray = hash.split("&");
    // eslint-disable-next-line no-unused-vars
    let state;
    let jwtauth_code;
    let jwtaccess_token;
    let jwtid_token;
    let jwtstate;
    hashArray.forEach((hash) => {
      const harray = hash.split("=");
      if (harray[0] === "#state" || harray[0] === "state") {
        state = harray[1];
      }
      if (harray[0] === "code") {
        jwtauth_code = harray[1];
      }
      if (harray[0] === "access_token") {
        jwtaccess_token = harray[1];
      }
      if (harray[0] === "id_token") {
        jwtid_token = harray[1];
      }
      if (harray[0] === "#state") {
        jwtstate = harray[1];
      }
    });
    // const state = hashArray[0].substring(hashArray[0].indexOf("=") + 1);
    // const jwtauth_code = hashArray[1].substring(hashArray[1].indexOf("=") + 1);
    // const jwtaccess_token = hashArray[2].substring(hashArray[2].indexOf("=") + 1);
    // const jwtid_token = hashArray[5].substring(hashArray[5].indexOf("=") + 1);
    let method = "POST";
    let body = "auth_code=" + jwtauth_code + "&id_token=" + jwtid_token;
    let url = "https://tokenrefreshservice.apps.emea.vwapps.io/exchangeAuthCode";
    let headers = {
      // "user-agent": this.userAgent,
      "X-App-version": this.xappversion,
      "content-type": "application/x-www-form-urlencoded",
      "x-app-name": this.xappname,
      accept: "application/json",
    };
    if (this.config.type === "vw" || this.config.type === "vwv2") {
      body += "&code_verifier=" + code_verifier;
    } else {
      const brand = this.config.type === "skodae" ? "skoda" : this.config.type;

      body += "&brand=" + brand;
    }
    if (this.config.type === "skodae") {
      const parsedParameters = qs.parse(hash);
      this.config.atoken = parsedParameters.access_token;
      method = "POST";
      url = "https://api.connect.skoda-auto.cz/api/v1/authentication/token?systemId=TECHNICAL";
      body = JSON.stringify({
        authorizationCode: parsedParameters.code,
      });
      headers = {
        accept: "*/*",
        authorization: "Bearer " + parsedParameters.id_token,
        "content-type": "application/json",
        "user-agent": this.useragent,
        "accept-language": "de-de",
      };
    }
    if (this.config.type === "go") {
      url = "https://dmp.apps.emea.vwapps.io/mobility-platform/token";
      body =
        "code=" +
        jwtauth_code +
        "&client_id=" +
        this.clientId +
        "&redirect_uri=vwconnect://de.volkswagen.vwconnect/oauth2redirect/identitykit&grant_type=authorization_code&code_verifier=" +
        code_verifier;
    }
    if (this.config.type === "seatcupra") {
      url = "https://identity.vwgroup.io/oidc/v1/token";
      body =
        "code=" +
        jwtauth_code +
        "&client_id=" +
        this.clientId +
        "&redirect_uri=" +
        this.redirect +
        "&grant_type=authorization_code&code_verifier=" +
        code_verifier;
      headers = {
        accept: "*/*",
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        authorization:
          "Basic M2M3NTZkNDYtZjFiYS00ZDc4LTlmOWEtY2ZmMGQ1MjkyZDUxQGFwcHNfdnctZGlsYWJfY29tOmViODgxNGU2NDFjODFhMjY0MGFkNjJlZWNjZWMxMWM5OGVmZmM5YmNjZDQyNjlhYjdhZjMzOGI1MGE5NGIzYTI=",
        "user-agent": "CUPRAApp%20-%20Store/20220207 CFNetwork/1240.0.4 Darwin/20.6.0",
        "accept-language": "de-de",
      };
    }
    if (this.config.type === "audidata") {
      url = "https://audi-global-dmp.apps.emea.vwapps.io/mobility-platform/token";
      body =
        "code=" +
        jwtauth_code +
        "&client_id=" +
        this.clientId +
        "&redirect_uri=acpp://de.audi.connectplugandplay/oauth2redirect/identitykit&grant_type=authorization_code&code_verifier=" +
        code_verifier;
    }
    if (this.config.type === "id") {
      url = "https://login.apps.emea.vwapps.io/login/v1";
      let redirerctUri = "weconnect://authenticated";

      body = JSON.stringify({
        state: jwtstate,
        id_token: jwtid_token,
        redirect_uri: redirerctUri,
        region: "emea",
        access_token: jwtaccess_token,
        authorizationCode: jwtauth_code,
      });
      // @ts-ignore
      headers = {
        accept: "*/*",
        "content-type": "application/json",
        "x-newrelic-id": "VgAEWV9QDRAEXFlRAAYPUA==",
        "user-agent": this.userAgent,
        "accept-language": "de-de",
      };
      if (this.type === "Wc") {
        method = "GET";
        url =
          "https://wecharge.apps.emea.vwapps.io/user-identity/v1/identity/login?redirect_uri=wecharge://authenticated&code=" +
          jwtauth_code;
        redirerctUri = "wecharge://authenticated";
        headers["x-api-key"] = "yabajourasW9N8sm+9F/oP==";
      }
    }
    if (this.config.type === "audi") {
      this.getVWToken({}, jwtid_token, reject, resolve);
      return;
    }
    if (this.config.type === "seatelli" || this.config.type === "skodapower") {
      url = "https://api.elli.eco/identity/v1/loginOrSignupWithIdKit";
      let brand = "seat";
      let redirect = "Seat-elli-hub://opid";
      if (this.config.type === "skodapower") {
        brand = "skoda";
        redirect = "skoda-hub://opid";
      }
      body = JSON.stringify({
        brand: brand,
        grant_type: "authorization_code",
        code: jwtauth_code,
        redirect_uri: redirect,
        code_verifier: code_verifier,
      });
      // @ts-ignore
      headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "User-Agent": this.userAgent,
        "Accept-Language": "de-DE",
      };
    }
    request(
      {
        method: method,
        url: url,
        headers: headers,
        body: body,
        jar: this.jar,
        gzip: true,
        followAllRedirects: false,
      },
      (err, resp, body) => {
        if (err || (resp && resp.statusCode >= 400)) {
          this.log.error("Failed to get token");
          err && this.log.error(err);
          resp && this.log.error(resp.statusCode.toString());
          body && this.log.error(JSON.stringify(body));
          reject();
          return;
        }
        try {
          const tokens = JSON.parse(body);

                    this.getVWToken(tokens, jwtid_token, reject, resolve);
                } catch (err) {
                    this.log.error(err);
                    reject();
                }
      },
        );
    }

    getVWToken(tokens, jwtid_token, reject, resolve) {
        if (this.config.type !== "audi") {
            if (this.config.type === "id") {
                if (this.type === "Wc") {
                    this.config.wc_access_token = tokens.wc_access_token;
                    this.config.wc_refresh_token = tokens.refresh_token;
                    this.log.debug("Wallcharging login successfull");
                    this.getWcData(100);
                    resolve();
                    return;
                }
                this.config.atoken = tokens.accessToken;
                this.config.rtoken = tokens.refreshToken;

                //configure for wallcharging login

        this.refreshTokenInterval = setInterval(() => {
          this.refreshIDToken().catch(() => {});
        }, 0.9 * 60 * 60 * 1000); // 0.9hours
        this.log.info("ID login successfull");
        this.log.info(`History limit: ${this.config.historyLimit}, set to -1 to disable wallcharging login`);
        if (this.config.historyLimit == -1) {
          this.log.info("History limit is set to -1, no wall charging login");
          resolve();
          return;
        }
        this.log.info("Start Wallcharging login");
        //this.config.type === "wc"
        this.type = "Wc";
        this.country = "DE";
        this.clientId = "0fa5ae01-ebc0-4901-a2aa-4dd60572ea0e@apps_vw-dilab_com";
        this.xclientId = "";
        this.scope = "openid profile address email";
        this.redirect = "wecharge://authenticated";
        this.xrequest = "com.volkswagen.weconnect";
        this.responseType = "code id_token token";
        this.xappversion = "";
        this.xappname = "";
        this.login()
          .then(() => {
            this.log.info("Wallcharging login was successfull");
          })
          .catch(() => {
            this.log.warn("Failled wall charger login");
          });
        resolve();
        return;
      }

      if (this.config.atoken) {
        this.secondAccessToken = this.config.atoken;
        this.secondRefreshToken = this.config.rtoken;
      }
      this.config.atoken = tokens.access_token || tokens.accessToken;
      this.config.rtoken = tokens.refresh_token || tokens.refreshToken;
      if (this.config.type === "seatelli" || this.config.type === "skodapower") {
        this.config.atoken = tokens.token;
      }
      if (this.config.type === "seatcupra") {
        if (this.refreshTokenInterval) {
          clearInterval(this.refreshTokenInterval);
        }
        this.refreshTokenInterval = setInterval(() => {
          this.refreshSeatCupraToken().catch(() => {});
        }, 0.9 * 60 * 60 * 1000); // 0.9hours
        resolve();
        return;
      }
      if (this.refreshTokenInterval) {
        clearInterval(this.refreshTokenInterval);
      }
      this.refreshTokenInterval = setInterval(() => {
        this.refreshToken().catch(() => {
          this.log.error("Refresh Token was not successful");
        });
        if (this.secondAccessToken) {
          this.refreshToken(null, true).catch(() => {
            this.log.error("Refresh Second Token was not successful");
          });
        }
      }, 0.9 * 60 * 60 * 1000); // 0.9hours
    }
    if (
      this.config.type === "go" ||
      this.config.type === "id" ||
      this.config.type === "skodae" ||
      this.config.type === "seatcupra" ||
      this.config.type === "seatelli" ||
      this.config.type === "skodapower" ||
      this.config.type === "audietron" ||
      this.config.type === "audidata"
    ) {
      resolve();
      return;
    }
    request.post(
      {
        url: "https://mbboauth-1d.prd.ece.vwg-connect.com/mbbcoauth/mobile/oauth2/v1/token",
        headers: {
          "User-Agent": this.userAgent,
          "X-App-Version": this.xappversion,
          "X-App-Name": this.xappname,
          "X-Client-Id": this.xclientId,
          Host: "mbboauth-1d.prd.ece.vwg-connect.com",
        },
        form: {
          grant_type: "id_token",
          token: jwtid_token,
          scope: "sc2:fal",
        },
        jar: this.jar,
        gzip: true,
        followAllRedirects: true,
      },
      (err, resp, body) => {
        if (err || (resp && resp.statusCode >= 400)) {
          this.log.error("Failed to get VWToken");
          err && this.log.error(err);
          resp && this.log.error(resp.statusCode.toString());
          body && this.log.error(JSON.stringify(body));
          resolve();
          return;
        }
        try {
          const tokens = JSON.parse(body);
          this.config.vwatoken = tokens.access_token;
          this.config.vwrtoken = tokens.refresh_token;
          if (this.vwrefreshTokenInterval) {
            clearInterval(this.vwrefreshTokenInterval);
          }
          this.vwrefreshTokenInterval = setInterval(() => {
            this.refreshToken(true).catch(() => {
              this.log.error("Refresh Token was not successful");
            });
          }, 0.9 * 60 * 60 * 1000); //0.9hours
          resolve();
        } catch (err) {
          this.log.error(err);
          reject();
        }
      },
    );
  }

  refreshToken(isVw, useSecondToken) {
    let url = "https://tokenrefreshservice.apps.emea.vwapps.io/refreshTokens";
    let rtoken = this.config.rtoken;
    if (useSecondToken) {
      rtoken = this.secondRefreshToken;
    }
    let body = "refresh_token=" + rtoken;
    let form = "";
    let brand = this.config.type === "skodae" ? "skoda" : this.config.type;

    if (this.config.type === "vwv2") {
      brand = "vw";
    }

    if (this.config.type === "seatelli") {
      brand = "seat";
    }
    body = "brand=" + brand + "&" + body;
    let headers = {
      "user-agent": this.userAgent,
      "content-type": "application/x-www-form-urlencoded",
      "X-App-version": this.xappversion,
      "X-App-name": this.xappname,
      "X-Client-Id": this.xclientId,
      accept: "application/json",
    };
    if (isVw) {
      url = "https://mbboauth-1d.prd.ece.vwg-connect.com/mbbcoauth/mobile/oauth2/v1/token";
      rtoken = this.config.vwrtoken;
      body = "grant_type=refresh_token&scope=sc2%3Afal&token=" + rtoken; //+ "&vin=" + vin;
    } else if (this.config.type === "go") {
      url = "https://dmp.apps.emea.vwapps.io/mobility-platform/token";
      body = "";
      // @ts-ignore
      form = {
        scope: "openid+profile+address+email+phone",
        client_id: this.clientId,
        grant_type: "refresh_token",
        refresh_token: rtoken,
      };
    } else if (this.config.type === "audidata") {
      url = "https://audi-global-dmp.apps.emea.vwapps.io/mobility-platform/token";
      body = "";
      // @ts-ignore
      form = {
        scope: "openid+profile+address+email+phone",
        client_id: this.clientId,
        grant_type: "refresh_token",
        refresh_token: rtoken,
      };
    } else if (this.config.type === "seatelli" || this.config.type === "skodapower") {
      url = "https://api.elli.eco/identity/v1/loginOrSignupWithIdkit";
      body = this.config.type === "seatelli" ? "seat" : "skoda";
      body = JSON.stringify({
        brand: brand,
        grant_type: "refresh_token",
        refresh_token: rtoken,
      });
      // @ts-ignore
      headers = {
        "Content-Type": "application/json",
        Accept: "application/json",
        "user-agent": this.userAgent,
        "Accept-Language": "de-DE",
      };
    }
    return new Promise((resolve, reject) => {
      this.log.debug("refreshToken ");
      this.log.debug(isVw ? "vw" : "");
      this.log.debug(`${url} ${body} ${JSON.stringify(form)}`);
      request.post(
        {
          url: url,
          headers: headers,
          body: body,
          form: form,
          gzip: true,
          followAllRedirects: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            this.log.error("Failing to refresh token. ");
            this.log.error(isVw ? "VwToken" : "");
            err && this.log.error(err);
            body && this.log.error(body);
            resp && this.log.error(resp.statusCode.toString());
            this.log.error("Restart adapter in 10min");
            setTimeout(() => {
              this.restart();
            }, 10 * 60 * 1000);

            reject();
            return;
          }
          try {
            this.log.debug(url);
            this.log.debug("Token refreshed");
            this.log.debug(JSON.stringify(body));
            const tokens = JSON.parse(body);
            if (tokens.error) {
              this.log.error(JSON.stringify(body));
              clearTimeout(this.refreshTokenTimeout);
              this.refreshTokenTimeout = setTimeout(() => {
                this.refreshTokenTimeout = null;
                this.refreshToken(isVw).catch(() => {
                  this.log.error("refresh token failed");
                });
              }, 5 * 60 * 1000);
              reject();
              return;
            }
            if (isVw) {
              this.config.vwatoken = tokens.access_token;
              if (tokens.refresh_token) {
                this.config.vwrtoken = tokens.refresh_token;
              }
            } else {
              if (useSecondToken) {
                this.secondAccessToken = tokens.access_token;
                this.secondRefreshToken = tokens.refresh_token;
                resolve();
                return;
              }
              this.config.atoken = tokens.access_token;
              if (tokens.refresh_token) {
                this.config.rtoken = tokens.refresh_token;
              }
              if (tokens.accessToken) {
                this.config.atoken = tokens.accessToken;
                this.config.rtoken = tokens.refreshToken;
              }
              if (tokens.token) {
                this.config.atoken = tokens.token;
              }
            }
            resolve();
          } catch (err) {
            this.log.error("Failing to parse refresh token. The instance will do restart and try a relogin.");
            this.log.error(err);
            this.log.error(JSON.stringify(body));
            this.log.error(resp.statusCode.toString());
            this.log.error(err.stack);
            this.restart();
          }
        },
      );
    });
  }

  getPersonalData() {
    return new Promise((resolve, reject) => {
      this.log.debug("START getPersonalData()");
      if (
        this.config.type === "audi" ||
        this.config.type === "go" ||
        this.config.type === "audidata" ||
        this.config.type === "audietron" ||
        this.config.type === "id" ||
        this.config.type === "seatelli" ||
        this.config.type === "skodapower"
      ) {
        resolve();
        return;
      }
      if (this.config.type === "seatcupra") {
        request.get(
          {
            url: "https://identity-userinfo.vwgroup.io/oidc/userinfo",
            headers: {
              "user-agent": this.userAgent,
              authorization: "Bearer " + this.config.atoken,
              accept: "*/*",
            },
            followAllRedirects: true,
            json: true,
            gzip: true,
          },
          (err, resp, body) => {
            if (err || (resp && resp.statusCode >= 400)) {
              err && this.log.error(err);
              resp && this.log.error(resp.statusCode.toString());
              body && this.log.error(JSON.stringify(body));
              reject();
              return;
            }
            try {
              if (body.sub) {
                this.seatcupraUser = body.sub;
                resolve();
              } else {
                this.log.error("No User ID found");
                reject();
              }
            } catch (err) {
              this.log.error(err);
              reject();
            }
          },
        );
        return;
      }

      this.log.debug("getPersonalData");
      request.get(
        {
          url: "https://customer-profile.apps.emea.vwapps.io/v1/customers/" + this.config.userid + "/personalData",
          headers: {
            "user-agent": this.userAgent,
            "X-App-version": this.xappversion,
            "X-App-name": this.xappname,
            authorization: "Bearer " + this.config.atoken,
            accept: "application/json",
            Host: "customer-profile.apps.emea.vwapps.io",
          },
          followAllRedirects: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            reject();
            return;
          }
          try {
            if (body.error) {
              this.log.error(JSON.stringify(body.error));
              reject();
            }
            this.log.debug(JSON.stringify(body));
            const data = JSON.parse(body);
            this.config.identifier = data.businessIdentifierValue;
            this.json2iob.parse("personal", data, { forceIndex: true });

            resolve();
          } catch (err) {
            this.log.error(err);
            reject();
          }
        },
      );
    });
  }
  getHomeRegion(vin) {
    return new Promise((resolve, reject) => {
      this.log.debug("START getHomeRegion");
      request.get(
        {
          url: "https://mal-1a.prd.ece.vwg-connect.com/api/cs/vds/v1/vehicles/" + vin + "/homeRegion",
          headers: {
            "user-agent": this.userAgent,
            "X-App-version": this.xappversion,
            "X-App-name": this.xappname,
            authorization: "Bearer " + this.config.vwatoken,
            accept: "application/json",
          },
          followAllRedirects: true,
          gzip: true,
          json: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            reject();
            return;
          }
          try {
            if (body.error) {
              this.log.error(JSON.stringify(body.error));
              reject();
            }
            this.log.debug(vin + ": " + JSON.stringify(body));
            this.homeRegion[vin] = "https://msg.volkswagen.de";
            if (body.homeRegion && body.homeRegion.baseUri && body.homeRegion.baseUri.content) {
              if (body.homeRegion.baseUri.content !== "https://mal-1a.prd.ece.vwg-connect.com/api") {
                this.homeRegion[vin] = body.homeRegion.baseUri.content.split("/api")[0].replace("mal-", "fal-");
                this.homeRegionSetter[vin] = body.homeRegion.baseUri.content.split("/api")[0];
                this.log.debug("Set URL to: " + this.homeRegion[vin]);
              }
            }
            resolve();
          } catch (err) {
            this.log.error(err);
            reject();
          }
        },
      );
    });
  }
  getCarData() {
    return new Promise((resolve, reject) => {
      this.log.debug("getData");
      request.get(
        {
          url: "https://customer-profile.apps.emea.vwapps.io/v1/customers/" + this.config.userid + "/realCarData",
          headers: {
            "user-agent": this.userAgent,
            "X-App-version": this.xappversion,
            "X-App-name": this.xappname,
            authorization: "Bearer " + this.config.atoken,
            accept: "application/json",
            Host: "customer-profile.apps.emea.vwapps.io",
          },
          followAllRedirects: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            reject();
            return;
          }
          try {
            if (body.error) {
              this.log.error(JSON.stringify(body.error));
              reject();
            }
                        this.log.debug("getCarData: " + JSON.stringify(body));
                        this.carData = body;
                        this.boolFinishCarData = true;
            const data = JSON.parse(body);

            resolve();
          } catch (err) {
            this.log.error(err);
            reject();
          }
        },
      );
    });
  }

  getVehicles() {
    return new Promise((resolve, reject) => {
      this.log.debug("START getVehicles");
      if (this.config.type === "seatelli" || this.config.type === "skodapower") {
        resolve();
        return;
      }
      let method = "get";
      let body = {};
      let url = this.replaceVarInUrl(
        "https://msg.volkswagen.de/fs-car/usermanagement/users/v1/$type/$country/vehicles",
      );
      let headers = {
        "User-Agent": this.userAgent,
        "X-App-Version": this.xappversion,
        "X-App-Name": this.xappname,
        Authorization: "Bearer " + this.config.vwatoken,
        Accept: "application/json",
      };
      if (this.config.type === "go") {
        url = "https://dmp.apps.emea.vwapps.io/mobility-platform/vehicles";
        // @ts-ignore
        headers = {
          "user-agent": "okhttp/3.9.1",
          authorization: "Bearer " + this.config.atoken,
          "accept-language": "de-DE",
          "dmp-api-version": "v2.0",
          "dmp-client-info": "Android/7.0/VW Connect/App/2.9.4",
          accept: "application/json;charset=UTF-8",
        };
      }
      if (this.config.type === "audidata") {
        url = "https://audi-global-dmp.apps.emea.vwapps.io/mobility-platform/vehicles";
        // @ts-ignore
        headers = {
          "user-agent": "okhttp/3.9.1",
          authorization: "Bearer " + this.config.atoken,
          "accept-language": "de-DE",
          "dmp-api-version": "v2.0",
          "dmp-client-info": this.userAgent,
          accept: "application/json;charset=UTF-8",
        };
      }
      if (this.config.type === "audietron") {
        method = "post";
        url = "https://app-api.live-my.audi.com/vgql/v1/graphql";
        // @ts-ignore
        headers = {
          "user-agent": this.userAgent,
          authorization: "Bearer " + this.aaztoken.access_token,
          "accept-language": "de-DE",
          "dmp-api-version": "v2.0",
          "dmp-client-info": this.userAgent,
          accept: "application/json;charset=UTF-8",
        };
        body = {
          query:
            "query vehicleList {\n  userVehicles {\n    vin\n    mappingVin\n    csid\n    commissionNumber\n    type\n    devicePlatform\n    mbbConnect\n    userRole {\n      role\n    }\n    vehicle {\n      classification {\n        driveTrain\n      }\n    }\n    nickname\n  }\n}",
        };
      }
      if (this.config.type === "id") {
        url = "https://mobileapi.apps.emea.vwapps.io/vehicles";
        // @ts-ignore
        headers = {
          accept: "*/*",
          "content-type": "application/json",
          "content-version": "1",
          "x-newrelic-id": "VgAEWV9QDRAEXFlRAAYPUA==",
          "user-agent": this.userAgent,
          "accept-language": "de-de",
          authorization: "Bearer " + this.config.atoken,
        };
      }
      if (this.config.type === "skodae") {
        url = "https://api.connect.skoda-auto.cz/api/v3/garage";
        // @ts-ignore
        headers = {
          accept: "application/json",
          "content-type": "application/json;charset=utf-8",
          "user-agent": this.userAgent,
          "accept-language": "de-de",
          authorization: "Bearer " + this.config.atoken,
        };
      }
      if (this.config.type === "seatcupra") {
        url = "https://ola.prod.code.seat.cloud.vwgroup.com/v1/users/" + this.seatcupraUser + "/garage/vehicles";
        // @ts-ignore
        headers = {
          accept: "application/json",
          "content-type": "application/json;charset=utf-8",
          "user-agent": this.userAgent,
          "accept-language": "de-de",
          authorization: "Bearer " + this.config.atoken,
        };
      }
      request(
        {
          method: method,
          url: url,
          headers: headers,
          followAllRedirects: true,
          gzip: true,
          json: true,
          ...(Object.keys(body).length && { body }),
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            if (resp && resp.statusCode === 429) {
              this.log.error(
                "Too many requests. Please turn on your car to send new requests. Maybe force update/update erzwingen is too often.",
              );
            }
            err && this.log.error(err);
            body && this.log.error(JSON.stringify(body));
            resp && this.log.error(resp.statusCode.toString());
            reject();
            return;
          }
          try {
            if (body.errorCode) {
              this.log.error(JSON.stringify(body));
              reject();
              return;
            }
                        this.log.debug("getVehicles: " + JSON.stringify(body));
                        this.vehicles = body;
                        this.boolFinishVehicles = true;

                        if (this.config.type === "id") {
              this.log.info("Found " + body.data.length + " vehicles");
                            body.data.forEach((element) => {
                                const vin = element.vin;
                this.log.info(`Create vehicle ${vin}`);
                if (!vin) {
                  this.log.info("No vin found for:" + JSON.stringify(element));
                  return;
                }
                                this.vinArray.push(vin);

              });
              resolve();
              return;
            }
            if (this.config.type === "go") {
              body.forEach((element) => {
                const vin = element.vehicle.vin;
                                const adapter = this;

                                traverse(element).forEach(function (value) {
                                    if (this.path.length > 0 && this.isLeaf) {
                                        const modPath = this.path;
                                        this.path.forEach((pathElement, pathIndex) => {
                                            if (!isNaN(parseInt(pathElement))) {
                                                let stringPathIndex = parseInt(pathElement) + 1 + "";
                                                while (stringPathIndex.length < 2) stringPathIndex = "0" + stringPathIndex;
                                                const key = this.path[pathIndex - 1] + stringPathIndex;
                                                const parentIndex = modPath.indexOf(pathElement) - 1;
                                                modPath[parentIndex] = key;
                                                modPath.splice(parentIndex + 1, 1);
                                            }
                                        });
                    let name = this.key;
                    if (typeof this.key === "number") {
                      name = this.key.toString();
                    }
                                        if (typeof value === "object") {
                                            value = JSON.stringify(value);
                                        }
                                    }
                                });
                            });
                            resolve();
                            return;
                        }
            if (this.config.type === "audidata") {
              body.forEach(async (element) => {
                const vin = element.vehicle.vin;
                this.vinArray.push(vin);
                                const adapter = this;

                                const result = body.vehicleData;

                                traverse(element).forEach(function (value) {
              });
              resolve();
              return;
            }
            if (this.config.type === "seatcupra") {
              body.vehicles.forEach((element) => {
                const vin = element.vin;
                if (!vin) {
                  this.log.info("No vin found for:" + JSON.stringify(element));
                  return;
                }
                this.vinArray.push(vin);
 
              });
              resolve();
              return;
            }
            if (this.config.type === "skodae") {
              this.log.info(`Found ${body.vehicles.length} vehicles`);
              body.vehicles.forEach(async (element) => {
                const vin = element.vin;
                this.vinArray.push(vin);
                await this.setObjectNotExistsAsync(element.vin, {
                  type: "device",
                  common: {
                    name: element.specification.title,
                    role: "indicator",
                    type: "string",
                    write: false,
                    read: true,
                  },
                  native: {},
                });

                                        if (typeof value === "object") {
                                            value = JSON.stringify(value);
              });
              resolve();
              return;
            }

            if (this.config.type === "audietron") {
              if (body.errors) {
                this.log.error(JSON.stringify(body.errors));
                reject();
                return;
              }
              body.data.userVehicles.forEach(async (element) => {
                const vin = element.vin;
                this.vinArray.push(vin);
                                });
                            });
                            resolve();
                            return;
                        }
                        if (!body.userVehicles) {
                            this.log.info("No Vehicles found");
                            resolve();
                            return;
                        }
                        const vehicles = body.userVehicles.vehicle;
                        vehicles.forEach((vehicle) => {
                            this.vinArray.push(vehicle);
                        });
            resolve();
          } catch (err) {
            this.log.error(err);
            this.log.error(err.stack);
            this.log.error("Not able to find vehicle, did you choose the correct type in the settings?");
            reject();
          }
        },
      );
    });
        this.log.debug("END getVehicles");
    }

    getIdStatus(vin) {
    return new Promise(async (resolve, reject) => {
      this.log.debug("START getIdStatus");
      await axios({
        method: "get",
        url: "https://mobileapi.apps.emea.vwapps.io/vehicles/" + vin + "/parkingposition",
        headers: {
          "content-type": "application/json",
          accept: "*/*",
          authorization: "Bearer " + this.config.atoken,
          "accept-language": "de-DE,de;q=0.9",
          "user-agent": this.userAgent,
          "content-version": "1",
        },
      })
        .then((res) => {
          if (res.status == 200) {
            this.setIsCarMoving(vin, false);
          } else if (res.status == 204) {
            this.setIsCarMoving(vin, true);
          }
          this.log.debug(JSON.stringify(res.data));
          //this.extractKeys(this, vin + ".parkingposition", res.data.data);
          this.positionData = res.data.data;
        })
        .catch((error) => {
          this.log.debug(error);
          //   error.response && this.log.error(JSON.stringify(error.response.data));
        });

      await axios({
        method: "get",
        url: "https://mobileapi.apps.emea.vwapps.io/vehicles/" + vin + "/selectivestatus?jobs=all",
        headers: {
          "content-type": "application/json",
          accept: "*/*",
          authorization: "Bearer " + this.config.atoken,
          "accept-language": "de-DE,de;q=0.9",
          "user-agent": this.userAgent,
          "content-version": "1",
        },
      })
        .then(async (res) => {
          this.log.debug(JSON.stringify(res.data));
          this.log.debug("getIdStatus: " + JSON.stringify(res.data));
          this.idData = res.data;
          this.boolFinishIdData = true;
          const data = {};
          for (const key in res.data) {
            for (const subkey in res.data[key]) {
              if (key === "userCapabilities") {
                data[key] = res.data[key];
              } else {
                data[subkey] = res.data[key][subkey].value || {};
              }
            }
          }

          // this.extractKeys(this, vin + ".status", data);
          this.json2iob.parse(vin + ".status", data, { forceIndex: true });
          if (this.config.rawJson) {
            this.log.info(".");

          }
          resolve();
        })
        .catch((error) => {
          this.log.error(error);
          error.response && this.log.error(JSON.stringify(error.response.data));
          reject();
        });
    });
  }

  getSeatCupraStatus(vin) {
    return new Promise((resolve, reject) => {
      this.log.debug("START getSeatCupraStatus");
      request.get(
        {
          url:
            "https://ola.prod.code.seat.cloud.vwgroup.com/v2/users/" +
            this.seatcupraUser +
            "/vehicles/" +
            vin +
            "/mycar",

          headers: {
            accept: "*/*",

            "user-agent": this.userAgent,
            "accept-language": "de-de",
            authorization: "Bearer " + this.config.atoken,
          },
          followAllRedirects: true,
          gzip: true,
          json: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            body && this.log.error(JSON.stringify(body));

            reject();
            return;
          }
          this.log.debug("getSeatCupraStatus: " + JSON.stringify(body));
          this.carData.Status = body;
          this.boolFinishCarDataStatus = true;
          try {
            //this.extractKeys(this, vin + ".status", body);
            if (this.config.rawJson) {
              this.log.debug(".");

            }
            resolve();
          } catch (err) {
            this.log.error(err);
            reject();
          }
        },
      );

      request.get(
        {
          url: "https://ola.prod.code.seat.cloud.vwgroup.com/vehicles/" + vin + "/charging/status",

          headers: {
            accept: "*/*",
            "user-agent": this.userAgent,
            "accept-language": "de-de",
            authorization: "Bearer " + this.config.atoken,
          },
          followAllRedirects: true,
          gzip: true,
          json: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            body && this.log.error(JSON.stringify(body));
            return;
          }
          this.log.debug("getSeatCupraStatus.chargingStatus: " + JSON.stringify(body));
          this.carData.chargingStatus = body;
          this.boolFinishCarDataChargingStatus = true;
          try {
            //this.extractKeys(this, vin + ".charging", body.status);
          } catch (err) {
            this.log.error(err);
          }
        },
      );
      request.get(
        {
          url: "https://ola.prod.code.seat.cloud.vwgroup.com/vehicles/" + vin + "/climatisation/status",

          headers: {
            accept: "*/*",
            "user-agent": this.userAgent,
            "accept-language": "de-de",
            authorization: "Bearer " + this.config.atoken,
          },
          followAllRedirects: true,
          gzip: true,
          json: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            body && this.log.error(JSON.stringify(body));
            return;
          }
          this.log.debug("getSeatCupraStatus.climatisationStatus: " + JSON.stringify(body));
          this.carData.climatisationStatus = body;
          this.boolFinishCarDataClimatisationStatus = true;
          try {
            //this.extractKeys(this, vin + ".climatisation", body.data);
          } catch (err) {
            this.log.error(err);
          }
        },
      );
    });
  }
  setSeatCupraStatus(vin, action, state) {
    return new Promise((resolve, reject) => {
      this.log.debug("START setSeatCupraStatus");
      request.post(
        {
          url: "https://ola.prod.code.seat.cloud.vwgroup.com/vehicles/" + vin + "/" + action + "/requests/" + state,
          headers: {
            accept: "*/*",
            "user-agent": this.userAgent,
            "accept-language": "de-de",
            authorization: "Bearer " + this.config.atoken,
          },
          followAllRedirects: true,
          gzip: true,
          json: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            body && this.log.error(JSON.stringify(body));
            reject();
            return;
          }
          this.log.info(JSON.stringify(body));
          resolve();
        },
      );
    });
  }
  getAudiDataStatus(vin) {
    return new Promise((resolve, reject) => {
      this.log.debug("START getAudiDataStatus");
      const statusArray = [
        {
          path: "driverlog",
          url:
            "https://audi-global-dmp.apps.emea.vwapps.io/mobility-platform/vehicle/" +
            vin +
            "/driverlogs?page=0&limit=100&returnPollData=true",
        },
        {
          path: "lastParkingPosition",
          url:
            "https://audi-global-dmp.apps.emea.vwapps.io/mobility-platform/vehicle/" + vin + "/last-parking-position",
        },
        {
          path: "status",
          url: "https://audi-global-dmp.apps.emea.vwapps.io/mobility-platform/vehicles",
        },
      ];
      statusArray.forEach((element) => {
        const url = element.url;
        this.log.debug(url);
        request.get(
          {
            url: url,

            headers: {
              accept: "application/json;charset=UTF-8",
              "dmp-api-version": "v2.0",
              "accept-language": "de-DE",
              "dmp-client-info": "Android/8.0.0/Audi Connect/App/2.5.0",
              "content-type": "application/json;charset=UTF-8",
              "user-agent": this.userAgent,
              "If-None-Match": this.etags[url] || "",
              authorization: "Bearer " + this.config.atoken,
            },
            followAllRedirects: true,
            gzip: true,
            json: true,
          },
          (err, resp, body) => {
            if (err || (resp && resp.statusCode >= 400)) {
              err && this.log.debug(err);
              resp && this.log.debug(resp.statusCode.toString());
              body && this.log.debug(JSON.stringify(body));
              reject();
              return;
            }
            if (resp) {
              this.etags[url] = resp.headers.etag;
              if (resp.statusCode === 304) {
                this.log.debug("304 No values updated");
                resolve();
                return;
              }
            }
            let preferedName = null;
            if (element.path === "status") {
              body = body[0];
            }
            if (element.path === "driverlog") {
              preferedName = "driverLogId";
            }

            this.log.debug("getAudiData: " + JSON.stringify(body));
            this.carData = body;
            this.boolFinishCarData = true;
            try {
              this.extractKeys(this, vin + "." + element.path, body, preferedName);

              resolve();
            } catch (err) {
              this.log.error(err);
              reject();
            }
          },
        );
      });
    });
  }
  async getSkodaEStatus(vin) {
    this.log.debug("START getSkodaEStatus");
    const statusArray = [
      { path: "air-conditioning", version: "v1", postfix: "/status" },
      { path: "air-conditioning", version: "v1", postfix: "/settings" },
      { path: "air-conditioning", version: "v1", postfix: "/timers" },
      { path: "charging", version: "v1", postfix: "/status" },
      { path: "charging", version: "v1", postfix: "/settings" },
      { path: "vehicle-status", version: "v2", postfix: "" },
      { path: "position/vehicles", version: "v1", postfix: "/parking-position" }, //need second auth
    ];

    for (const status of statusArray) {
      const url =
        "https://api.connect.skoda-auto.cz/api/" + status.version + "/" + status.path + "/" + vin + status.postfix;
      const headers = {
        "api-key": "ok",
        accept: "application/json",
        "content-type": "application/json;charset=utf-8",
        "user-agent": this.userAgent,
        "accept-language": "de-de",
        "If-None-Match": this.etags[url] || "",
        authorization: "Bearer " + this.config.atoken,
      };
      if (status.path === "position/vehicles") {
        if (!this.secondAccessToken) {
          this.log.warn("Missing second auth token for parking position");
          continue;
        }
        headers["Authorization"] = "Bearer " + this.secondAccessToken;
      }
      await axios({
        method: "get",
        url: url,
        headers: headers,
      })
        .then(async (res) => {
          this.log.debug("getSeatCupraStatus.chargingStatus: " + JSON.stringify(res.data));
          this.carData = res.data;
          this.boolFinishCarData = true;
          let path = vin + ".status." + status.path.replace("/", "");
          if (status.postfix) {
            path += "." + status.postfix.replace("/", "");
          }
          this.log.debug(path);
//          this.extractKeys(this, path, res.data);
//          this.etags[url] = res.headers.etag;
          if (this.config.rawJson) {

          }
        })
        .catch((error) => {
          if (error.response) {
            if (error.response.status === 304) {
              this.log.debug("304 No values updated");
              return;
            }
            this.log.error(JSON.stringify(error.response.data));
          }
          this.log.error(error);
          this.log.error(url);
        });
    }
  }

  setSkodaESettings(vin, action, value, bodyContent) {
    return new Promise(async (resolve, reject) => {
      this.log.debug("START setSkodaESettings");
      const pre = this.name + "." + this.instance;
      let body = bodyContent || {};
      if (value !== "UpdateSettings") {
        const states = await this.getStatesAsync(pre + "." + vin + ".status." + action + ".settings.*");
        body = {};
        const allIds = Object.keys(states);
        allIds.forEach((keyName) => {
          const keyNameArray = keyName.split(".");
          const key = keyNameArray[keyNameArray.length - 1];
          const subKey = keyNameArray[keyNameArray.length - 2];
          if (subKey === "settings" && states[keyName]) {
            body[key] = states[keyName].val;
          } else if (states[keyName]) {
            if (!body[subKey]) {
              body[subKey] = {};
            }
            body[subKey][key] = states[keyName].val;
          }
        });
      }
      const settingsName = this.toCammelCase(action) + "Settings";
      const finalBody = {
        type: value,
      };
      finalBody[settingsName] = body;
      const method = "POST";
      const url = "https://api.connect.skoda-auto.cz/api/v1/" + action + "/operation-requests?vin=" + vin;
      this.log.debug(url);
      this.log.debug(JSON.stringify(finalBody));
      request(
        {
          method: method,
          url: url,
          headers: {
            "api-key": "ok",
            accept: "application/json",
            "content-type": "application/json;charset=utf-8",
            "user-agent": this.userAgent,
            "accept-language": "de-de",
            authorization: "Bearer " + this.config.atoken,
          },
          body: finalBody,
          followAllRedirects: true,
          json: true,
          gzip: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            if (resp && resp.statusCode === 401) {
              err && this.log.error(err);
              resp && this.log.error(resp.statusCode.toString());
              body && this.log.error(JSON.stringify(body));
              this.refreshToken().catch(() => {});
              this.log.error("Refresh Token");
              reject();
              return;
            }
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            body && this.log.error(JSON.stringify(body));
            reject();
            return;
          }
          try {
            this.log.debug(JSON.stringify(body));
            resolve();
          } catch (err) {
            this.log.error(err);
            reject();
          }
        },
      );
    });
  }
  async getElliData(type) {
    this.log.debug("START getElliData");
    if (this.config.historyLimit === -1) {
      return;
    }
    let name = "Seat Elli Data";
    let path = "seatelli";
    if (type === "skodapower") {
      name = "Skoda Powerpass Data";
      path = "skodapower";
    }
    const header = {
      "Content-Type": "application/json",
      Accept: "application/json",
      "User-Agent": this.userAgent,
      "Accept-Language": "de-DE",
      Authorization: "Bearer " + this.config.atoken,
    };

    const endpoints = [
      "identity/v1/userinfo",
      "customer/v1/cars",
      "customer/v1/subscriptions",
      "customer/v1/rfidcards",
      "chargeathome/v1/chargingsessions",
      "customer/v1/orders",
      "customer/v1/charging/sessions",
      "customer/v1/invoices",
      "customer/v1/orders",
      "customer/v1/subscriber",
    ];
    endpoints.forEach((element) => {
      const elementArray = element.split("/");
      this.genericRequest(
        "https://api.elli.eco/" + element,
        header,
        path + "." + elementArray[elementArray.length - 1],
        [404, 409],
      ).catch((hideError, err) => {
        if (hideError) {
          return;
        }
        this.log.error(err);
      });
    });
    this.genericRequest(
      "https://api.elli.eco/customer/v1/charging/records?limit=" + this.config.historyLimit + "&offset=0",
      header,
      path + ".records",
      [404],
    ).catch((hideError, err) => {
      if (hideError) {
        return;
      }
      this.log.error(err);
    });

    this.genericRequest("https://api.elli.eco/chargeathome/v1/stations", header, path + ".stations", [404], "stations")
      .then((body) => {
        this.log.debug("START getElliData: " + JSON.stringify(body));
        this.elliStations = body;
        this.boolFinishElliStations = true;
        body.forEach((station) => {
          this.genericRequest(
            "https://api.elli.eco/chargeathome/v1/stations/" + station.id,
            header,
            path + ".stations." + station.name,
            [404],
          ).catch((hideError) => {
            if (hideError) {
              this.log.debug("Failed to get sessions");
              return;
            }
            this.log.error("Failed to get sessions");
          });
          this.genericRequest(
            "https://api.elli.eco/chargeathome/v1/chargingrecords?station_id=" +
              station.id +
              "&limit=" +
              this.config.historyLimit +
              "&offset=0",
            header,
            path + ".stations." + station.name + ".chargingrecords",
            [404],
          ).catch((hideError) => {
            if (hideError) {
              this.log.debug("Failed to get sessions");
              return;
            }
            this.log.error("Failed to get sessions");
          });
          this.genericRequest(
            "https://api.elli.eco/chargeathome/v1/chargingrecords/total-charged?station_id=" +
              station.id +
              "&limit=" +
              this.config.historyLimit +
              "&offset=0",
            header,
            path + ".stations." + station.name + ".chargingrecords.total-charged",
            [404],
          ).catch((hideError) => {
            if (hideError) {
              this.log.debug("Failed to get total-charged");
              return;
            }
            this.log.error("Failed to get total-charged");
          });
        });
      })
      .catch((hideError, err) => {
        boolFinishElliStations = true;
        if (hideError) {
          this.log.debug("Failed to get stations");
          this.log.debug(err);
          return;
        }
        this.log.error("Failed to get stations");
        this.log.error(err);
      });
  }


    getWcData(limit) {
    if (limit == -1) {
      this.log.debug("We Charge disabled in config");
      return;
    }
        if (!limit) {
            limit = 25;
        }
        const header = {
            accept: "*/*",
            "content-type": "application/json",
            "content-version": "1",
            "x-newrelic-id": "VgAEWV9QDRAEXFlRAAYPUA==",
            "user-agent": this.userAgent,
            "accept-language": "de-de",
            authorization: "Bearer " + this.config.atoken,
            wc_access_token: this.config.wc_access_token,
        };
    this.genericRequest(
      "https://wecharge.apps.emea.vwapps.io/charge-and-pay/v1/user/subscriptions",
      header,
      "wecharge.chargeandpay.subscriptions",
      [404],
      "result",
    )
            .then((body) => {
                body.forEach((subs) => {
          this.genericRequest(
            "https://wecharge.apps.emea.vwapps.io/charge-and-pay/v1/user/tariffs/" + subs.tariff_id,
            header,
            "wecharge.chargeandpay.tariffs." + subs.tariff_id,
            [404],
          ).catch((hideError) => {
                        if (hideError) {
                            this.log.debug("Failed to get tariff");
                            return;
                        }
                        this.log.error("Failed to get tariff");
                    });
                });
            })
            .catch((hideError) => {
                if (hideError) {
                    this.log.debug("Failed to get subscription");
                    return;
                }
                this.log.error("Failed to get subscription");
            });
    this.genericRequest(
      "https://wecharge.apps.emea.vwapps.io/charge-and-pay/v1/charging/records?limit=" + limit + "&offset=0",
      header,
      "wecharge.chargeandpay.records",
      [404, 500],
      "result",
    )
            .then((body) => {
                this.log.debug("wecharge.chargeandpay.recordsJson: " + JSON.stringify(body));
                this.chargeAndPay = body;
                this.boolFinishChargeAndPay = true;
            })
            .catch((hideError) => {
                this.boolFinishChargeAndPay = true;
                if (hideError) {
                    this.log.debug("Failed to get chargeandpay records");
                    return;
                }
                this.log.error("Failed to get chargeandpay records");

            });
    this.genericRequest(
      "https://wecharge.apps.emea.vwapps.io/home-charging/v1/stations?limit=" + limit,
      header,
      "wecharge.homecharging.stations",
      [404],
      "result",
      "stations",
    )
            .then((body) => {
                this.stations = body;
                this.boolFinishStations = true;
                body.forEach((station) => {
                    this.log.debug("Station: " + station.name + "/" + station.id);
          this.genericRequest(
            "https://wecharge.apps.emea.vwapps.io/home-charging/v1/charging/sessions?station_id=" +
              station.id +
              "&limit=" +
              limit,
            header,
            "wecharge.homecharging.stations." + station.name + ".sessions",
            [404],
            "charging_sessions",
          )
            .then((body) => {
                           this.log.debug("wecharge.homecharging.stations." + station.name + ".sessions.latestItem: " + JSON.stringify(body[0]));
                        })
                        .catch((hideError) => {
                            if (hideError) {
                                this.log.debug("Failed to get sessions");
                                return;
                            }
                            this.log.error("Failed to get sessions");
                        });
                });
            })
            .catch((hideError) => {
                this.boolFinishStations = true;
                if (hideError) {
                    this.log.debug("Failed to get stations");
                    return;
                }
                this.log.error("Failed to get stations");
            });
        const dt = new Date();
        this.genericRequest(
      "https://wecharge.apps.emea.vwapps.io/home-charging/v1/charging/records?start_date_time_after=2020-05-01T00:00:00.000Z&start_date_time_before=" +
        dt.toISOString() +
        "&limit=" +
        limit,
            header,
            "wecharge.homecharging.records",
            [404],
      "charging_records",
        )
            .then((body) => {
                this.log.debug("wecharge.homecharging.records.latestItem: " + JSON.stringify(body));
                this.homechargingRecords = body;
                this.boolFinishHomecharging = true;
            })
            .catch((hideError) => {
                this.boolFinishHomecharging = true;
                if (hideError) {
                    this.log.debug("Failed to get records");
                    return;
                }
                this.log.error("Failed to get records");
            });
        //Pay
        //Home
    }

    genericRequest(url, header, path, codesToIgnoreArray, selector1, selector2) {
        return new Promise(async (resolve, reject) => {
           header["If-None-Match"] = this.etags[url] || "";
            request.get(
                {
                    url: url,
                    headers: header,
                    followAllRedirects: true,
                    gzip: true,
                    json: true,
                },
                (err, resp, body) => {
                    if (err || (resp && resp.statusCode >= 400)) {
                        if (resp && resp.statusCode && codesToIgnoreArray.includes(resp.statusCode)) {
                            err && this.log.debug(err);
                            resp && this.log.debug(resp.statusCode.toString());
                            body && this.log.debug(JSON.stringify(body));
                            reject(true, err);
                            return;
                        }
                        err && this.log.error(err);
                        resp && this.log.error(resp.statusCode.toString());
                        body && this.log.error(JSON.stringify(body));
                        reject(false, err);
                        return;
                    }
          this.log.debug("genericRequest: " + url);
          this.log.debug(JSON.stringify(body));
          this.etags[url] = resp.headers.etag;
          if (resp.statusCode === 304) {
            this.log.debug("304 No values updated");
            resolve();
            return;
          }
                    try {
                        if (selector1) {
                            body = body[selector1];
                            if (selector2) {
                                body = body[selector2];
                            }
                        }
                        resolve(body);
                    } catch (err) {
                        this.log.error(err);
                        reject();
                    }
                }, /* TODO possible comma problem */
            );
        });
    }


    setIdRemote(vin, action, value, bodyContent) {
        return new Promise(async (resolve, reject) => {
            this.log.debug("setIdRemote >>");
            const pre = this.name + "." + this.instance;
            let body = bodyContent || {};
            if (action === "climatisation" && value === "start") {
                const climateStates = this.idData.data.climatisationSettings; // get this from the internal object filled by getData()
                body = {};
                const allIds = Object.keys(climateStates);
                allIds.forEach((keyName) => {
                    const key = keyName.split(".").splice(-1)[0];
                    if (this.config.targetTempC >= 16 && this.config.targetTempC <= 27) {
                        if (key == "targetTemperature_C") {
                            climateStates[keyName] = this.config.targetTempC;
                        }
                        if (key == "targetTemperature_K") {
                            climateStates[keyName] = this.config.targetTempC + 273.15;
                        }
                    }
                    else
                    {
                        this.log.error("Cannot set temperature to " + this.config.targetTempC + "°C.");
                        reject();
                        return;
                    }
                    if (key.indexOf("Timestamp") === -1) {
                        body[key] = climateStates[keyName];
                    }
                });

                // body = JSON.stringify(body);
            }
            if (action === "charging" && value === "settings") {
                const chargingStates = this.idData.data.chargingSettings; // get this from the internal object filled by getData()
                body = {};
                const allIds = Object.keys(chargingStates);
                allIds.forEach((keyName) => {
                    const key = keyName.split(".").splice(-1)[0];
                    if (this.config.targetSOC > 0 && this.config.targetSOC <= 100) {
                        if (key == "targetSOC_pct") {
                            chargingStates[keyName] = this.config.targetSOC;
                        }
                    }
                    else
                    {
                        this.log.error("Cannot set target SOC to " + this.config.targetSOC + "%.");
                        reject();
                        return;
                    }
                    if (key.indexOf("Timestamp") === -1) {
                        body[key] = chargingStates[keyName];
                    }
                });

                // body = JSON.stringify(body);
            }
            let method = "POST";
            if (value === "settings") {
                method = "PUT";
            }
            this.log.debug("https://mobileapi.apps.emea.vwapps.io/vehicles/" + vin + "/" + action + "/" + value);
            this.log.debug("setIdRemote: " + JSON.stringify(body));
            request(
                {
                    method: method,
                    url: "https://mobileapi.apps.emea.vwapps.io/vehicles/" + vin + "/" + action + "/" + value,

                    headers: {
                        "content-type": "application/json",
                        accept: "*/*",
                        "accept-language": "de-de",
                        "user-agent": this.userAgent,
                        "content-version": "1",
                        "x-newrelic-id": "VgAEWV9QDRAEXFlRAAYPUA==",
                        authorization: "Bearer " + this.config.atoken,
                    },
                    body: body,
                    followAllRedirects: true,
                    json: true,
                    gzip: true,
                },
                (err, resp, body) => {
                    if (err || (resp && resp.statusCode >= 400)) {
                        if (resp && resp.statusCode === 401) {
                            err && this.log.error(err);
                            resp && this.log.error(resp.statusCode.toString());
                            body && this.log.error(JSON.stringify(body));
                            if (this.config.type === "audietron") {
                              this.refreshTokenv2().catch(() => {});
                            } else {
                              this.refreshIDToken().catch(() => {});
                            }
                            this.log.error("Refresh Token");
                            reject();
                            return;
                        }
                        err && this.log.error(err);
                        resp && this.log.error(resp.statusCode.toString());
                        body && this.log.error(JSON.stringify(body));
                        reject();
                        return;
                    }
                    try {
                        this.log.debug(JSON.stringify(body));
                        resolve();
                    } catch (err) {
                        this.log.error(err);
                        reject();
                    }
        }, /* TODO possible comma problem */
      );
    });
  }
  refreshTokenv2() {
    return new Promise((resolve, reject) => {
      this.log.debug("Token Refresh started");
      const body = {
        client_id: this.clientId,
        grant_type: "refresh_token",
        refresh_token: this.config.rtoken,
        response_type: "token id_token",
      };
      const headers = {
        accept: "application/json",
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
        "accept-charset": "utf-8",
        "x-qmauth": this.getQmauth(),
        "accept-language": "de-de",
        "user-agent": "myAudi-Android/4.6.0 (Build 800236847.2111261819) Android/11",
      };
      request(
        {
          method: "POST",
          url: "https://idkproxy-service.apps.emea.vwapps.io/v1/emea/token",
          headers: headers,
          followAllRedirects: true,
          gzip: true,
          json: true,
          body: qs.stringify(body),
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            body && this.log.error(JSON.stringify(body));
            this.log.error("Failed refresh token. restart adapter in 10min");
            setTimeout(() => {
              this.log.error("restart adapter");
              this.restart();
            }, 10 * 60 * 1000);
            reject();
            return;
          }
          try {
            this.log.debug("Token Refresh successful");
            this.config.atoken = body.access_token;
            this.config.rtoken = body.refresh_token;

            resolve();
          } catch (err) {
            this.log.error(err);
            reject();
          }
        }, /* TODO possible comma problem */
      );
    });
  }

    refreshIDToken() {
        return new Promise((resolve, reject) => {
            this.log.debug("Token Refresh started");
            request.get(
                {
                    url: "https://login.apps.emea.vwapps.io/refresh/v1",

                    headers: {
                        accept: "*/*",
                        "content-type": "application/json",
                        "content-version": "1",
                        "x-newrelic-id": "VgAEWV9QDRAEXFlRAAYPUA==",
                        "user-agent": this.userAgent,
                        "accept-language": "de-de",
                        authorization: "Bearer " + this.config.rtoken,
                    },
                    followAllRedirects: true,
                    gzip: true,
                    json: true,
                },
                (err, resp, body) => {
                    if (err || (resp && resp.statusCode >= 400)) {
                        err && this.log.error(err);
                        resp && this.log.error(resp.statusCode.toString());
                        body && this.log.error(JSON.stringify(body));
                        this.log.error("Failed refresh token. Relogin");
                        //reset login parameters because of wecharge
                        this.type = "Id";
                        this.clientId = "a24fba63-34b3-4d43-b181-942111e6bda8@apps_vw-dilab_com";
                        this.scope = "openid profile badge cars dealers birthdate vin";
                        this.redirect = "weconnect://authenticated";
                        this.xrequest = "com.volkswagen.weconnect";
                        this.responseType = "code id_token token";
                        setTimeout(() => {
                            this.log.error("Relogin");
                            this.login().catch(() => {
                                this.log.error("Failed relogin");
                            });
                        }, 10 * 60 * 1000);
                        reject();
                        return;
                    }
                    try {
                        this.log.debug("Token Refresh successful");
                        this.config.atoken = body.accessToken;
                        this.config.rtoken = body.refreshToken;
                        if (this.type === "Wc") {
                            //wallcharging relogin no refresh token available
                            this.login().catch(() => {
                                this.log.debug("No able to Login in WeCharge");
                            });
                        }
                        resolve();
                    } catch (err) {
                        this.log.error(err);
                        reject();
                    }
        }, /* TODO possible comma problem */
      );
    });
  }
  refreshSeatCupraToken() {
    return new Promise((resolve, reject) => {
      this.log.debug("Token Refresh started");
      request.post(
        {
          url: "https://identity.vwgroup.io/oidc/v1/token",
          body:
            "client_secret=eb8814e641c81a2640ad62eeccec11c98effc9bccd4269ab7af338b50a94b3a2&client_id=" +
            this.clientId +
            "&grant_type=refresh_token&refresh_token=" +
            this.config.rtoken,
          headers: {
            accept: "*/*",
            "content-type": "application/x-www-form-urlencoded; charset=utf-8",
            "user-agent": this.userAgent,
            "accept-language": "de-de",
          },
          followAllRedirects: true,
          gzip: true,
          json: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            body && this.log.error(JSON.stringify(body));
            this.log.error("Failed refresh token. Relogin");

            setTimeout(() => {
              this.log.error("restart adapter in 10min");
              this.restart();
            }, 10 * 60 * 1000);
            reject();
            return;
          }
          try {
            this.log.debug("Token Refresh successful");
            this.config.atoken = body.access_token;
            this.config.rtoken = body.refresh_token;

            resolve();
          } catch (err) {
            this.log.error(err);
            reject();
          }
        }, /* TODO possible comma problem */
      );
    });
  }
  getVehicleData(vin) {
    return new Promise((resolve, reject) => {
      if (this.config.type === "go") {
        resolve();
        return;
      }
      let accept =
        "application/vnd.vwg.mbb.vehicleDataDetail_v2_1_0+json, application/vnd.vwg.mbb.genericError_v1_0_2+json";
      let url = this.replaceVarInUrl(
        "$homeregion/fs-car/vehicleMgmt/vehicledata/v2/$type/$country/vehicles/$vin/",
        vin,
      );
      if (
        this.config.type !== "vw" &&
        this.config.type !== "vwv2" &&
        this.config.type !== "audi" &&
        this.config.type !== "id" &&
        this.config.type !== "seat" &&
        this.config.type !== "skoda"
      ) {
        url = this.replaceVarInUrl(
          "https://msg.volkswagen.de/fs-car/promoter/portfolio/v1/$type/$country/vehicle/$vin/carportdata",
          vin,
        );
        accept = "application/json";
      }
      const atoken = this.config.vwatoken;

            request.get(
                {
                    url: url,
                    headers: {
                        "User-Agent": this.userAgent,
                        "X-App-Version": this.xappversion,
                        "X-App-Name": this.xappname,
                        "X-Market": "de_DE",
                        Authorization: "Bearer " + atoken,
                        "If-None-Match": this.etags[url] || "",
                        Accept: accept,
                    },
                    followAllRedirects: true,
                    gzip: true,
                    json: true,
                },
                (err, resp, body) => {
                    if (err || (resp && resp.statusCode >= 400)) {
                        if (resp && resp.statusCode === 429) {
                          this.log.error(
                            "Too many requests. Please turn on your car to send new requests. Maybe force update/update erzwingen is too often.",
                          );
                        }
                        err && this.log.error(err);
                        resp && this.log.error(resp.statusCode.toString());
                        body && this.log.error(JSON.stringify(body));
                        reject();
                        return;
                    }
                    try {
                        this.log.debug(JSON.stringify(body));
                        let result = body.vehicleData;
                        if (!result) {
                            result = body.vehicleDataDetail;
                        }
                        if (resp) {
                            this.etags[url] = resp.headers.etag;
                            if (resp.statusCode === 304) {
                                this.log.debug("304 No values updated");
                                resolve();
                                return;
                            }
                        }
                        if (result && result.carportData && result.carportData.modelName) {
                            this.updateName(vin, result.carportData.modelName);
                        }

                        resolve();
                    } catch (err) {
                        this.log.error(err);
                        reject();
                    }
                }, /* TODO possible comma problem */
            );
        });
    }

    getVehicleRights(vin) {
        return new Promise((resolve, reject) => {
            if (this.config.type === "go" || !this.config.rights) {
                resolve();
                return;
            }
            let url = "https://mal-1a.prd.ece.vwg-connect.com/api/rolesrights/operationlist/v3/vehicles/" + vin;
            if (this.config.type === "vw" || this.config.type === "vwv2") {
                url += "/users/" + this.config.identifier;
            }
            request.get(
                {
                    url: url,
                    qs: {
                        scope: "All",
                    },
                    headers: {
                        "User-Agent": this.userAgent,
                        "X-App-Version": this.xappversion,
                        "X-App-Name": this.xappname,
                        Authorization: "Bearer " + this.config.vwatoken,
                        Accept:
                          "application/json, application/vnd.vwg.mbb.operationList_v3_0_2+xml, application/vnd.vwg.mbb.genericError_v1_0_2+xml",
                    },
                    followAllRedirects: true,
                    gzip: true,
                    json: true,
                },
                (err, resp, body) => {
                    if (err || (resp && resp.statusCode >= 400)) {
                        if (resp && resp.statusCode === 429) {
                          this.log.error(
                            "Too many requests. Please turn on your car to send new requests. Maybe force update/update erzwingen is too often.",
                          );
                        }
                        err && this.log.error(err);
                        resp && this.log.error(resp.statusCode.toString());
                        reject();
                        return;
                    }
                    try {
                        const adapter = this;
                        traverse(body.operationList).forEach(function (value) {
                            if (this.path.length > 0 && this.isLeaf) {
                                const modPath = this.path;
                                this.path.forEach((pathElement, pathIndex) => {
                                    if (!isNaN(parseInt(pathElement))) {
                                        let stringPathIndex = parseInt(pathElement) + 1 + "";
                                        while (stringPathIndex.length < 2) stringPathIndex = "0" + stringPathIndex;
                                        const key = this.path[pathIndex - 1] + stringPathIndex;
                                        const parentIndex = modPath.indexOf(pathElement) - 1;
                                        modPath[parentIndex] = key;
                                        modPath.splice(parentIndex + 1, 1);
                                    }
                                });
                                if (modPath[modPath.length - 1] !== "$") {
                                    if (typeof value === "object") {
                                        value = JSON.stringify(value);
                                    }
                                }
                            }
                        });

                        resolve();
                    } catch (err) {
                        this.log.error(err);
                        reject();
                    }
                }, /* TODO possible comma problem */
            );
        });
    }

  requestStatusUpdate(vin) {
    return new Promise((resolve, reject) => {
      try {
        let method = "POST";
        let url = this.replaceVarInUrl("$homeregion/fs-car/bs/vsr/v1/$type/$country/vehicles/$vin/requests", vin);

        let accept = "application/json";
        // if (this.config.type === "audi") {
        //     url = this.replaceVarInUrl("https://mal-3a.prd.eu.dp.vwg-connect.com/api/bs/vsr/v1/vehicles/$vin/requests", vin);
        // }
        if (this.config.type === "vw") {
          accept =
            "application/vnd.vwg.mbb.VehicleStatusReport_v1_0_0+json, application/vnd.vwg.mbb.climater_v1_0_0+json, application/vnd.vwg.mbb.carfinderservice_v1_0_0+json, application/vnd.volkswagenag.com-error-v1+json, application/vnd.vwg.mbb.genericError_v1_0_2+json";
        }
        if (this.config.type === "vwv2") {
          method = "GET";
          url = this.replaceVarInUrl("$homeregion/fs-car/vehicleMgmt/vehicledata/v2/$type/$country/vehicles/$vin", vin);
          accept =
            " application/vnd.vwg.mbb.vehicleDataDetail_v2_1_0+json, application/vnd.vwg.mbb.genericError_v1_0_2+json";
        }
        this.log.debug("Request update " + url);
        request(
          {
            method: method,
            url: url,
            headers: {
              "User-Agent": this.userAgent,
              "X-App-Version": this.xappversion,
              "X-App-Name": this.xappname,
              Authorization: "Bearer " + this.config.vwatoken,
              "Accept-charset": "UTF-8",
              Accept: accept,
            },
            followAllRedirects: true,
            gzip: true,
            json: true,
          },
          (err, resp, body) => {
            if (err || (resp && resp.statusCode >= 400)) {
              this.log.error(vin);
              if (resp && resp.statusCode === 429) {
                this.log.error(
                  "Too many requests. Please turn on your car to send new requests. Maybe force update/update erzwingen is too often.",
                );
              }
              err && this.log.error(err);
              resp && this.log.error(resp.statusCode.toString());
              body && this.log.error(JSON.stringify(body));
              reject();
              return;
            }
            try {
              this.log.debug(JSON.stringify(body));
              resolve();
            } catch (err) {
              this.log.error("Request update failed: " + url);
              this.log.error(vin);
              this.log.error(err);
              reject();
            }
          },
        );
      } catch (err) {
        this.log.error(err);
        reject();
      }
    });
  }

  getVehicleStatus(vin, url, path, element, element2, element3, element4, tripType) {
    return new Promise((resolve, reject) => {
      url = this.replaceVarInUrl(url, vin, tripType);
      if (path === "tripdata") {
        if (this.tripsActive == false) {
          resolve();
          return;
        }
      }
      let accept = "application/json";
      if (this.config.type === "vw" || this.config.type === "vwv2") {
        accept =
          "application/vnd.vwg.mbb.VehicleStatusReport_v1_0_0+json, application/vnd.vwg.mbb.climater_v1_0_0+json, application/vnd.vwg.mbb.carfinderservice_v1_0_0+json, application/vnd.volkswagenag.com-error-v1+json, application/vnd.vwg.mbb.genericError_v1_0_2+json, */*";
        if (this.homeRegion[vin] === "https://msg.volkswagen.de") {
          accept += ", application/json";
        }
      }
      request.get(
        {
          url: url,
          headers: {
            "User-Agent": this.userAgent,
            "X-App-Version": this.xappversion,
            "X-App-Name": this.xappname,
            "If-None-Match": this.etags[url] || "",
            Authorization: "Bearer " + this.config.vwatoken,
            "Accept-charset": "UTF-8",
            Accept: accept,
          },
          followAllRedirects: true,
          gzip: true,
          json: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            if (
              (resp && resp.statusCode === 403) ||
              (resp && resp.statusCode === 502) ||
              (resp && resp.statusCode === 406) ||
              (resp && resp.statusCode === 500)
            ) {
              body && this.log.debug(JSON.stringify(body));
              resolve();
              return;
            } else if (resp && resp.statusCode === 401) {
              this.log.error(vin);
              err && this.log.error(err);
              resp && this.log.error(resp.statusCode.toString());
              body && this.log.error(JSON.stringify(body));
              this.log.error("Refresh Token in 10min");
              if (!this.refreshTokenTimeout) {
                this.refreshTokenTimeout = setTimeout(() => {
                  this.refreshTokenTimeout = null;
                  this.refreshToken(true).catch(() => {
                    this.log.error("Refresh Token was not successful");
                  });
                }, 10 * 60 * 1000);
              }
              reject();
              return;
            } else {
              if (resp && resp.statusCode === 429) {
                this.log.error(
                  "Too many requests. Please turn on your car to send new requests. Maybe force update/update erzwingen is too often.",
                );
              }
              err && this.log.error(err);
              resp && this.log.error(resp.statusCode.toString());
              body && this.log.error(JSON.stringify(body));
              reject();
              return;
            }
          }
          try {
            this.log.debug(JSON.stringify(body));
            if (resp) {
              this.etags[url] = resp.headers.etag;
              if (resp.statusCode === 304) {
                this.log.debug("304 No values updated");
                resolve();
                return;
              }
            }
            if (path === "position") {
              if (body && body.storedPositionResponse && body.storedPositionResponse.parkingTimeUTC) {
                body.storedPositionResponse.position.parkingTimeUTC = body.storedPositionResponse.parkingTimeUTC;
              }
              this.setIsCarMoving(vin, resp.statusCode === 204);
            }

            if (body === undefined || body === "" || body.error) {
              if (body && body.error && body.error.description.indexOf("Token expired") !== -1) {
                this.log.error("Error response try to refresh token " + path);
                this.log.error(JSON.stringify(body));
                this.log.error("Refresh Token in 10min");
                if (!this.refreshTokenTimeout) {
                  this.refreshTokenTimeout = setTimeout(() => {
                    this.refreshTokenTimeout = null;
                    this.refreshToken(true).catch(() => {
                      this.log.error("Refresh Token was not successful");
                    });
                  }, 10 * 60 * 1000);
                }
              } else {
                this.log.debug("Not able to get " + path);
              }
              this.log.debug(JSON.stringify(body));
              reject();
              return;
            }

            const adapter = this;

            let result = body;
            if (result === "") {
              resolve();
              return;
            }
            if (result) {
              if (element && result[element]) {
                result = result[element];
              }
              if (element2 && result[element2]) {
                result = result[element2];
              }
              if (element3 && result[element3]) {
                result = result[element3];
              }
              if (element4 && result[element4]) {
                result = result[element4];
              }
              const isStatusData = path === "status";
              const isTripData = path === "tripdata";

              if (isTripData) {
                if (this.tripsActive == false) {
                  resolve();
                  return;
                }
                // result.tripData = result.tripData.reverse();
                result.tripData.sort((a, b) => {
                  return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
                });
                if (this.config.numberOfTrips > 0)
                  result.tripData = result.tripData.slice(0, this.config.numberOfTrips);
                                
                resolve();
                return;
              }

              let statusKeys = null;
              if (isStatusData) {
                statusKeys = this.getStatusKeys(result);
              }
              const tripKeys = null;

              traverse(result).forEach(function (value) {
                const modPath = this.path.slice();
                let dataId = null;
                let dataIndex = -1;
                let fieldId = null;
                let fieldUnit = null;
                let isNumberNode = false;
                let skipNode = false;
                this.path.forEach((pathElement, pathIndex) => {
                  if (isNaN(parseInt(pathElement))) {
                    isNumberNode = false;
                  } else {
                    isNumberNode = true;
                    let key;
                    if (isStatusData && this.path[pathIndex - 1] === "data") {
                      dataIndex = parseInt(pathElement);
                      dataId = statusKeys[dataIndex].dataId;
                      key = "_" + dataId;
                    } else if (isStatusData && this.path[pathIndex - 1] === "field") {
                      if (dataIndex >= 0) {
                        fieldId = statusKeys[dataIndex].fieldIds[parseInt(pathElement)].id;
                        key = "_" + fieldId;
                        if (this.key == "value" && statusKeys[dataIndex].fieldIds[parseInt(pathElement)].unit) {
                          fieldUnit = statusKeys[dataIndex].fieldIds[parseInt(pathElement)].unit;
                        }
                      } else {
                        adapter.log.error("no data entry found for field (path = " + this.path.join("."));
                        key = parseInt(pathElement) + 1 + "";
                      }
                    } else if (isTripData && this.path[pathIndex - 1]) {
                      const tripKey = tripKeys[parseInt(pathElement)];
                      if (tripKey === null) {
                        skipNode = true;
                      } else {
                        key = "_" + tripKeys[parseInt(pathElement)];
                      }
                    } else {
                      key = parseInt(pathElement) + 1 + "";
                      while (key.length < 2) key = "0" + key;
                    }
                    if (!skipNode) {
                      const parentIndex = modPath.indexOf(pathElement) - 1;
                      modPath[parentIndex] = this.path[pathIndex - 1] + key;
                      modPath.splice(parentIndex + 1, 1);
                    }
                  }
                });
                if (!skipNode) {
                  const newPath = vin + "." + path + "." + modPath.join(".");
                  if (this.path.length > 0 && this.isLeaf) {
                    value = value || this.node;
                    if (!isNaN(Number(value)) && Number(value) === parseFloat(value)) {
                      value = Number(value);
                    }
                    let name = this.key;
                    if (typeof this.key === "number") {
                      name = this.key.toString();
                    }
                        if (typeof value === "object") {
                          value = JSON.stringify(value);
                        }
                    //	setOutsideTemperature(vin, value);
                    //}
                    if (isStatusData && this.key == "value") {
                      // Audi and Skoda have different (shorter) dataId
                      if ((dataId == "0x030104FFFF" || dataId == "0x0301FFFFFF") && fieldId == "0x0301040001") {
                        //adapter.setIsCarLocked(vin, value == 2);
                      }
                      if ((dataId == "0x030102FFFF" || dataId == "0x0301FFFFFF") && fieldId == "0x0301020001") {
                        //adapter.setOutsideTemperature(vin, value);
                      }
                      adapter.updateUnit(newPath, fieldUnit);
                    }
                  } else if (isStatusData && isNumberNode) {
                    let text = null;
                    if (this.node.textId) {
                      text = this.node.textId;
                    }
                    adapter.updateName(newPath, text);
                  } else if (isTripData && isNumberNode) {
                    let text = null;
                    if (this.node.timestamp) {
                      text = this.node.timestamp;
                    }
                    adapter.updateName(newPath, text);
                  }
                }
              });
              resolve();
            } else {
              this.log.error("Cannot find vehicle data " + path);
              this.log.error(JSON.stringify(body));
              reject();
            }
          } catch (err) {
            this.log.error(err);
            this.log.error(err.stack);
            reject();
          }
        },
      );
    });
  }


  getStatusKeys(statusJson) {
    const adapter = this;
    let result = null;
    if (statusJson && statusJson.data) {
      if (Array.isArray(statusJson.data)) {
        result = new Array(statusJson.data.length);
        statusJson.data.forEach(function (dataValue, dataIndex) {
          if (dataValue && dataValue.id) {
            if (dataValue.field && Array.isArray(dataValue.field)) {
              const newList = new Array(dataValue.field.length);
              dataValue.field.forEach(function (fieldValue, fieldIndex) {
                if (fieldValue && fieldValue.id) {
                  newList[fieldIndex] = { id: fieldValue.id, unit: fieldValue.unit };
                } else {
                  adapter.log.warn("status[" + dataIndex + "," + fieldIndex + "] has no id");
                  adapter.log.debug(JSON.stringify(fieldValue));
                }
              });
              result[dataIndex] = { dataId: dataValue.id, fieldIds: newList };
            } else {
              adapter.log.warn("status[" + dataIndex + "] has no fields/is not an array");
              adapter.log.debug(JSON.stringify(dataValue));
            }
          } else {
            adapter.log.warn("status[" + dataIndex + "] has no id");
            adapter.log.debug(JSON.stringify(dataValue));
          }
        });
      } else {
        adapter.log.warn("status is not an array");
        adapter.log.debug(JSON.stringify(statusJson.data));
      }
    } else {
      adapter.log.warn("status data without status field");
      adapter.log.debug(JSON.stringify(statusJson));
    }
    adapter.log.debug(JSON.stringify(result));
    return result;
  }

  updateUnit(pathString, unit) {
    const adapter = this;
    this.getObject(pathString, function (err, obj) {
      if (err) adapter.log.error('Error "' + err + '" reading object ' + pathString + " for unit");
      else {
        // @ts-ignore
        if (obj && obj.common && obj.common.unit !== unit) {
          adapter.extendObject(pathString, {
            type: "state",
            common: {
              unit: unit,
            },
          });
        }
      }
    });
  }

  updateName(pathString, name) {
    const adapter = this;
    this.getObject(pathString, function (err, obj) {
      if (err) adapter.log.error('Error "' + err + '" reading object ' + pathString + " for name");
      else {
        if (obj && obj.common && obj.common.name !== name) {
          adapter.extendObject(pathString, {
            type: "channel",
            common: {
              name: name,
            },
          });
        }
      }
    });
  }

  setVehicleStatus(vin, url, body, contentType, secToken) {
    return new Promise((resolve, reject) => {
      url = this.replaceVarInUrl(url, vin);
      this.log.debug(JSON.stringify(body));
      this.log.debug(contentType);
      const headers = {
        "User-Agent": this.userAgent,
        "X-App-Version": this.xappversion,
        "X-App-Name": this.xappname,
        Authorization: "Bearer " + this.config.vwatoken,
        "Accept-charset": "UTF-8",
        "Content-Type": contentType,
        Accept:
          "application/json, application/vnd.vwg.mbb.ChargerAction_v1_0_0+xml,application/vnd.volkswagenag.com-error-v1+xml,application/vnd.vwg.mbb.genericError_v1_0_2+xml, application/vnd.vwg.mbb.RemoteStandheizung_v2_0_0+xml, application/vnd.vwg.mbb.genericError_v1_0_2+xml,application/vnd.vwg.mbb.RemoteLockUnlock_v1_0_0+xml,*/*",
      };

      if (secToken) {
        headers["x-mbbSecToken"] = secToken;
      }

      request.post(
        {
          url: url,
          headers: headers,
          body: body,
          followAllRedirects: true,
          gzip: true,
        },
        (err, resp, body) => {
          if (err || (resp && resp.statusCode >= 400)) {
            err && this.log.error(err);
            resp && this.log.error(resp.statusCode.toString());
            body && this.log.error(body);
            reject();
            return;
          }
          try {
            this.log.debug(JSON.stringify(body));
            if (body.indexOf("<error>") !== -1) {
              this.log.error("Error response try to refresh token " + url);
              this.log.error(JSON.stringify(body));
              this.refreshToken(true).catch(() => {
                this.log.error("Refresh Token was not successful");
              });
              reject();
              return;
            }
            resolve();
            this.log.info(body);
          } catch (err) {
            this.log.error(err);
            this.log.error(err.stack);
            reject();
          }
        }, /* TODO possible comma problem */
      );
    });
  }

    setVehicleStatusv2(vin, url, body, contentType, secToken) {
        return new Promise((resolve, reject) => {
            url = this.replaceVarInUrl(url, vin);
            this.log.debug(JSON.stringify(body));
            this.log.debug(contentType);
            const headers = {
                "User-Agent": this.userAgent,
                "X-App-Version": this.xappversion,
                "X-App-Name": this.xappname,
                Authorization: "Bearer " + this.config.vwatoken,
                "Accept-charset": "UTF-8",
                "Content-Type": contentType,
                Accept:
                    "application/json, application/vnd.vwg.mbb.ChargerAction_v1_0_0+xml,application/vnd.volkswagenag.com-error-v1+xml,application/vnd.vwg.mbb.genericError_v1_0_2+xml, application/vnd.vwg.mbb.RemoteStandheizung_v2_0_0+xml, application/vnd.vwg.mbb.genericError_v1_0_2+xml,application/vnd.vwg.mbb.RemoteLockUnlock_v1_0_0+xml,*/*",
            };
            if (secToken) {
                headers["x-mbbSecToken"] = secToken;
            }

            request.post(
                {
                    url: url,
                    headers: headers,
                    body: body,
                    followAllRedirects: true,
                    gzip: true,
                },
                (err, resp, body) => {
                    if (err || (resp && resp.statusCode >= 400)) {
                        err && this.log.error(err);
                        resp && this.log.error(resp.statusCode.toString());
                        reject();
                        return;
                    }
                    try {
                        this.log.debug(JSON.stringify(body));
                        if (body.indexOf("<error>") !== -1) {
                            this.log.error("Error response try to refresh token " + url);
                            this.log.error(JSON.stringify(body));
                            this.refreshToken(true).catch(() => {
                                this.log.error("Refresh Token was not successful");
                            });
                            reject();
                            return;
                        }
                        this.log.info(body);
                    } catch (err) {
                        this.log.error(err);
                        this.log.error(err.stack);
                        reject();
                    }
                }, /* TODO possible comma problem */
            );
        });
    }

    requestSecToken(vin, service) {
        return new Promise((resolve, reject) => {
            let url =
              "https://mal-1a.prd.ece.vwg-connect.com/api/rolesrights/authorization/v2/vehicles/" +
              vin +
              "/services/" +
              service +
              "/security-pin-auth-requested";
            if (this.homeRegionSetter[vin]) {
                url = url.replace("https://mal-1a.prd.ece.vwg-connect.com", this.homeRegionSetter[vin]);
            }
            this.log.debug(url);
            request.get(
                {
                    url: url,
                    headers: {
                        "user-agent": this.userAgent,
                        "X-App-version": this.xappversion,
                        "X-App-name": this.xappname,
                        authorization: "Bearer " + this.config.vwatoken,
                        accept: "application/json",
                    },
                    followAllRedirects: true,
                    json: true,
                    gzip: true,
                },
                async (err, resp, body) => {
                    if (err || (resp && resp.statusCode >= 400)) {
                        err && this.log.error(err);
                        resp && this.log.error(resp.statusCode.toString());
                        body && this.log.error(JSON.stringify(body));
                        reject();
                        return;
                    }
                    try {
                        if (body.error) {
                            this.log.error(JSON.stringify(body.error));
                            reject();
                        }
                        this.log.debug(JSON.stringify(body));
                        if (body.securityPinAuthInfo) {
                            const secToken = body.securityPinAuthInfo.securityToken;
                            const challenge = body.securityPinAuthInfo.securityPinTransmission.challenge;
                            const securPin = await this.generateSecurPin(challenge);
                            const rBody = {
                                securityPinAuthentication: {
                                    securityPin: {
                                        challenge: challenge,
                                        securityPinHash: securPin,
                                    },
                                    securityToken: secToken,
                                },
                            };
                            let url =
                              "https://mal-1a.prd.ece.vwg-connect.com/api/rolesrights/authorization/v2/security-pin-auth-completed";
                            if (this.homeRegionSetter[vin]) {
                                url = url.replace("https://mal-1a.prd.ece.vwg-connect.com", this.homeRegionSetter[vin]);
                            }
                            request.post(
                                {
                                    url: url,
                                    headers: {
                                        "user-agent": this.userAgent,
                                        "Content-Type": "application/json",
                                        "X-App-version": this.xappversion,
                                        "X-App-name": this.xappname,
                                        authorization: "Bearer " + this.config.vwatoken,
                                        Accept: "application/json",
                                    },
                                    body: rBody,
                                    gzip: true,
                                    json: true,
                                    followAllRedirects: true,
                                },
                                (err, resp, body) => {
                                    if (err || (resp && resp.statusCode >= 400)) {
                                        this.log.error("Failing to get sec token.");
                                        err && this.log.error(err);
                                        body && this.log.error(JSON.stringify(body));
                                        resp && this.log.error(resp.statusCode.toString());
                                        reject();
                                        return;
                                    }
                                    try {
                                        this.log.debug(JSON.stringify(body));
                                        if (body.securityToken) {
                                            resolve(body.securityToken);
                                        } else {
                                            this.log.error("No Security token found");
                                            this.log.error(JSON.stringify(body));
                                            reject();
                                        }
                                    } catch (err) {
                                        this.log.error(err);
                                        reject();
                                    }
                                }, /* TODO possible comma problem */
                            );
                        } else {
                            this.log.error("No Security information found");
                            this.log.error(JSON.stringify(body));
                            reject();
                        }
                    } catch (err) {
                        this.log.error(err);
                        reject();
                    }
                }, /* TODO possible comma problem */
            );
        });
    }

    generateSecurPin(challenge) {
        return new Promise((resolve, reject) => {
            if (!this.config.pin) {
                this.log.error("Please Enter your S-Pin in the Instance Options");
                reject();
                return;
            }
            const pin = this.toByteArray(this.config.pin);

            const byteChallenge = this.toByteArray(challenge);
            const webcrypto = new Crypto();
            const concat = new Int8Array(pin.concat(byteChallenge));
            webcrypto.subtle
                .digest("SHA-512", concat)
                .then((digest) => {
                    const utf8Array = new Int8Array(digest);
                    resolve(this.toHexString(utf8Array));
                })
                .catch((error) => {
                    this.log.error(error);
                });
        });
    }

  getCodeChallenge() {
    let hash = "";
    let result = "";
    const chars = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    result = "";
    for (let i = 64; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
    result = Buffer.from(result).toString("base64");
    result = result.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    hash = crypto.createHash("sha256").update(result).digest("base64");
    hash = hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    return [result, hash];
  }
  getCodeChallengev2() {
    let hash = "";
    let result = "";
    const chars = "0123456789abcdef";
    result = "";
    for (let i = 64; i > 0; --i) result += chars[Math.floor(Math.random() * chars.length)];
    hash = crypto.createHash("sha256").update(result).digest("base64");
    hash = hash.replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");

    return [result, hash];
  }

    getNonce() {
        const timestamp = Date.now();
        let hash = crypto.createHash("sha256").update(timestamp.toString()).digest("base64");
        hash = hash.slice(0, hash.length - 1);
        return hash;
    }

    toHexString(byteArray) {
        return Array.prototype.map
            .call(byteArray, function (byte) {
                return ("0" + (byte & 0xff).toString(16).toUpperCase()).slice(-2);
            })
            .join("");
    }

    toByteArray(hexString) {
        const result = [];
        for (let i = 0; i < hexString.length; i += 2) {
            result.push(parseInt(hexString.substr(i, 2), 16));
        }
        return result;
    }

    stringIsAValidUrl(s) {
        try {
            new URL(s);
            return true;
        } catch (err) {
            return false;
        }
    }

    randomString(length) {
        let result = "";
        const characters = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    }
  toCammelCase(string) {
    return string.replace(/-([a-z])/g, function (g) {
      return g[1].toUpperCase();
    });
  }
    extractHidden(body) {
        const returnObject = {};
        let matches;
        if (body.matchAll) {
            matches = body.matchAll(/<input (?=[^>]* name=["']([^'"]*)|)(?=[^>]* value=["']([^'"]*)|)/g);
        } else {
            this.log.warn("The adapter needs in the future NodeJS v12. https://forum.iobroker.net/topic/22867/how-to-node-js-f%C3%BCr-iobroker-richtig-updaten");
            matches = this.matchAll(/<input (?=[^>]* name=["']([^'"]*)|)(?=[^>]* value=["']([^'"]*)|)/g, body);
        }
        for (const match of matches) {
            returnObject[match[1]] = match[2];
        }
        return returnObject;
    }
  
    matchAll(re, str) {
        let match;
        const matches = [];

        while ((match = re.exec(str))) {
            // add all matched groups
            matches.push(match);
        }

        return matches;
    }
  
    /**
     * Is called when adapter shuts down - callback has to be called under any circumstances!
     * @param {() => void} callback
     */
    onUnload(/*callback*/) {
        try {
            this.log.debug("cleaned everything up...");
            clearInterval(this.refreshTokenInterval);
            clearInterval(this.vwrefreshTokenInterval);
            clearInterval(this.updateInterval);
            clearInterval(this.fupdateInterval);
            clearTimeout(this.refreshTokenTimeout);
            //callback();
            this.log.debug("onUnload: Success");
        } catch (e) {
            //callback();
            this.log.error("onUnload: Error");
        }
    }
  async updateGeohash(vin) {
    await this.sleep(5000); //wait for all states
    const latitude = await this.getStateAsync(vin + ".position.latitudeConv");
    if (latitude == null) {
      return;
    }
    const longitude = await this.getStateAsync(vin + ".position.longitudeConv");
    if (longitude == null) {
      return;
    }
    if (this.isFirstLocation === true) {
      this.isFirstLocation = false;
    } else {
      // Update only if one of both have been changed
      if (latitude.ts !== latitude.lc && longitude.ts !== longitude.lc) {
        this.log.debug(
          "No update lat ts " +
            latitude.ts +
            " <-> lc " +
            latitude.lc +
            ", long ts " +
            longitude.ts +
            " <-> lc " +
            longitude.lc,
        );
        return;
      }
      // Update only if both longitude and latitude were updated within the same 3 seconds.
      // Otherwise only one value of both were updated yet and coordinates are not yet valid.
      if (Math.abs(latitude.lc - longitude.lc) > 3000) {
        this.log.debug("No update lat = " + latitude.lc + ", long =" + longitude.lc);
        return;
      }
    }

    const latitudeValue = latitude.val;
    const longitudeValue = longitude.val;

    if (!this.config.reversePos) {
      this.log.debug("reverse pos deactivated");
      return;
    }
    await this.reversePosition(latitudeValue, longitudeValue, vin);
  }
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async reversePosition(latitudeValue, longitudeValue, vin) {
    this.log.debug("reverse pos started");

    request.get(
      {
        url:
          "https://nominatim.openstreetmap.org/reverse?lat=" +
          latitudeValue +
          "&lon=" +
          longitudeValue +
          "&format=json",

        headers: {
          "User-Agent": "ioBroker/vw-connect",
        },
        json: true,
        followAllRedirects: true,
      },
      async (err, resp, body) => {
        this.log.debug("reverse pos received");
        this.log.debug(JSON.stringify(body));
        if (err || resp.statusCode >= 400 || !body) {
          body && this.log.error(JSON.stringify(body));
          resp && this.log.error(resp.statusCode.toString());
          err && this.log.error(err);
          return;
        }
        if (body.display_name) {
          try {
            const timestamp = Date.now();
            const number = body.address.house_number || "";
            const city = body.address.city || body.address.town || body.address.village;
            const fullAdress =
              body.address.road +
              (number == "" ? "" : " ") +   // skip blank if house number missing
              number +
              ", " +
              body.address.postcode +
              " " +
              city +
              ", " +
              body.address.country;


            const keys = Object.keys(body.address);
            for (const keyIndex in keys) {
              const key = keys[keyIndex];

            }
            this.json2iob.cleanupOtherStatesInChannel(vin + ".position.address", timestamp);
          } catch (err) {
            this.log.error(err);
          }
        } else {
          this.log.error(JSON.stringify(body));
        }
      },
    );
  }

}

module.exports.VwWeConnect = VwWeConnect;
module.exports.Log = Log;
