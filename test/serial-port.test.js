const test = require('node:test');
const assert = require('node:assert/strict');

const { parsePortasArduino, listarPortasCandidatas } = require('../server.js');

test('parsePortasArduino separa portas por vírgula e espaços', () => {
  assert.deepEqual(parsePortasArduino('COM3, COM4 , COM5'), ['COM3', 'COM4', 'COM5']);
  assert.deepEqual(parsePortasArduino(''), []);
});

test('listarPortasCandidatas prioriza portas configuradas que existem', () => {
  assert.deepEqual(
    listarPortasCandidatas(['COM3', 'COM4'], ['COM4', 'COM5', 'COM6']),
    ['COM4', 'COM5', 'COM6']
  );
});

test('listarPortasCandidatas usa a primeira porta disponível quando nenhuma preferida existe', () => {
  assert.deepEqual(listarPortasCandidatas(['COM9'], ['COM4', 'COM5']), ['COM4', 'COM5']);
});
