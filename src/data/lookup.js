/**
 * Data access helpers.
 * ------------------------------------------------------------------
 * Thin, cached indexes over the reference data so the engine and UI never
 * scan arrays in a hot loop. State-scoped throughout, so nothing here
 * assumes a particular state is loaded.
 */
window.PG = window.PG || {};
PG.index = (function () {
  'use strict';

  var cache = {};

  function build(stateId) {
    var st = PG.getState(stateId);
    var seatDefs = st.seats();
    var geo = st.geometry();

    var byNum = {};
    seatDefs.forEach(function (d) {
      byNum[d.num] = d;
    });

    var geoByNum = {};
    geo.seats.forEach(function (g) {
      geoByNum[g.num] = g;
    });

    var districtOrder = Object.keys(st.districts()).sort(function (a, b) {
      var da = st.districts()[a];
      var db = st.districts()[b];
      if (da.region !== db.region) return da.region.localeCompare(db.region);
      return a.localeCompare(b);
    });

    return {
      stateDef: st,
      seatDefs: seatDefs,
      byNum: byNum,
      geoByNum: geoByNum,
      districts: st.districts(),
      regions: st.regions(),
      districtOrder: districtOrder,
      total: seatDefs.length,
      majority: st.majority(seatDefs.length),
    };
  }

  function get(stateId) {
    var id = stateId || PG.DEFAULT_STATE;
    if (!cache[id]) cache[id] = build(id);
    return cache[id];
  }

  return {
    get: get,
    seatDef: function (stateId, num) {
      return get(stateId).byNum[num];
    },
    seatGeo: function (stateId, num) {
      return get(stateId).geoByNum[num];
    },
    district: function (stateId, name) {
      return get(stateId).districts[name];
    },
    districtOrder: function (stateId) {
      return get(stateId).districtOrder;
    },
    majority: function (stateId) {
      return get(stateId).majority;
    },
    total: function (stateId) {
      return get(stateId).total;
    },
  };
})();
