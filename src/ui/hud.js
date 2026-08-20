/**
 * Top bar and seat meter.
 * ------------------------------------------------------------------
 * The one thing that must always be readable at a glance: how many seats am
 * I projected to win, and how far is that from a majority.
 */
window.PG = window.PG || {};
PG.ui = PG.ui || {};

PG.ui.hud = (function () {
  'use strict';

  var el = PG.ui.dom.el;
  var fmt = PG.ui.fmt;

  function create(opts) {
    var stat = {};

    function statBlock(id, label, extraClass) {
      var value = el('span', { class: 'stat-value', text: '—' });
      var sub = el('span', { class: 'stat-sub' });
      stat[id] = { value: value, sub: sub };
      return el('div', { class: 'stat' + (extraClass ? ' ' + extraClass : '') }, [
        el('span', { class: 'stat-label', text: label }),
        value,
        sub,
      ]);
    }

    var meterFill = el('span', { class: 'meter-fill' });
    var meterMarker = el('span', { class: 'meter-marker' }, [
      el('span', { class: 'meter-marker-label' }),
    ]);
    var meterTrack = el('div', { class: 'meter-track' }, [meterFill, meterMarker]);

    var meterHead = el('div', { class: 'meter-head' }, [
      el('div', { class: 'meter-primary' }, [
        el('span', { class: 'meter-number', text: '—' }),
        el('span', { class: 'meter-of', text: '' }),
      ]),
      el('div', { class: 'meter-need' }, [
        el('span', { class: 'meter-need-value', text: '—' }),
        el('span', { class: 'meter-need-label', text: 'still needed' }),
      ]),
    ]);

    var meter = el('div', { class: 'seat-meter' }, [meterHead, meterTrack]);

    var titleEl = el('div', { class: 'hud-title' }, [
      el('span', { class: 'hud-election', text: 'Punjab Assembly Election' }),
      el('span', { class: 'hud-sub', text: '' }),
    ]);

    var phasePill = el('span', { class: 'phase-pill', text: '' });

    var menuBtn = el('button', {
      class: 'btn btn-ghost',
      type: 'button',
      text: 'Menu',
      onclick: function () {
        if (opts.onMenu) opts.onMenu();
      },
    });

    var saveBtn = el('button', {
      class: 'btn btn-ghost',
      type: 'button',
      text: 'Save',
      onclick: function () {
        if (opts.onSave) opts.onSave();
      },
    });

    var root = el('header', { class: 'hud' }, [
      el('div', { class: 'hud-left' }, [titleEl, phasePill]),
      el('div', { class: 'hud-meter' }, [meter]),
      el('div', { class: 'hud-right' }, [
        el('div', { class: 'stat-row' }, [
          statBlock('week', 'Week'),
          statBlock('budget', 'In hand', 'stat-money'),
          statBlock('actions', 'Actions'),
        ]),
        el('div', { class: 'hud-buttons' }, [saveBtn, menuBtn]),
      ]),
    ]);

    function render(game, projection) {
      var stateDef = PG.getState(game.stateId);
      var party = PG.PARTY_BY_ID[game.player.partyId];
      var phase = PG.engine.phaseFor(stateDef, game.turn);
      var majority = projection.majority;
      var seats = projection.playerSeats;
      var needed = Math.max(0, majority - seats);

      titleEl.querySelector('.hud-sub').textContent =
        game.player.name + ' · ' + party.name;
      titleEl.style.setProperty('--party-colour', party.colour);

      phasePill.textContent =
        game.status === 'results'
          ? 'Result declared'
          : game.status === 'electionDay'
          ? 'Election Day'
          : phase.label;
      phasePill.className = 'phase-pill phase-' + (game.status === 'campaign' ? phase.id : game.status);

      stat.week.value.textContent =
        game.status === 'campaign' ? game.turn + ' / ' + stateDef.campaign.turns : '—';
      stat.week.sub.textContent =
        game.status === 'campaign'
          ? PG.engine.turnsLeft(game) + ' to go'
          : 'campaign closed';

      stat.budget.value.textContent = fmt.money(game, PG.engine.moneyLeft(game));
      stat.budget.sub.textContent = fmt.money(game, game.budget.spent) + ' spent';

      stat.actions.value.textContent =
        game.status === 'campaign'
          ? game.actionsLeft + ' / ' + stateDef.campaign.actionsPerTurn
          : '—';
      stat.actions.sub.textContent = 'this week';

      meterHead.querySelector('.meter-number').textContent = seats;
      meterHead.querySelector('.meter-of').textContent =
        'projected of ' + projection.total;
      meterHead.querySelector('.meter-need-value').textContent = needed;
      meterHead.querySelector('.meter-need-label').textContent =
        needed === 0 ? 'majority reached' : 'still needed for ' + majority;
      meterHead.classList.toggle('is-majority', needed === 0);

      meterFill.style.width = (seats / projection.total) * 100 + '%';
      meterFill.style.background = party.colour;
      meterMarker.style.left = (majority / projection.total) * 100 + '%';
      meterMarker.querySelector('.meter-marker-label').textContent = majority;
      meter.classList.toggle('is-majority', needed === 0);
    }

    return { root: root, render: render };
  }

  return { create: create };
})();
