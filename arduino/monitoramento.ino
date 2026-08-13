#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);

const int nivelBaixo = 2;
const int nivelAlto = 3;
const int releBomba = 7;
const int sensorCorrente = A0;

const int RELE_LIGADO = LOW;
const int RELE_DESLIGADO = HIGH;

int offsetCorrente = 0;
float corrente = 0;
bool bombaLigada = false;

void setup() {
  Serial.begin(9600);

  pinMode(nivelBaixo, INPUT_PULLUP);
  pinMode(nivelAlto, INPUT_PULLUP);
  pinMode(releBomba, OUTPUT);
  digitalWrite(releBomba, RELE_DESLIGADO);

  lcd.init();
  lcd.backlight();

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Sistema Agua");
  lcd.setCursor(0, 1);
  lcd.print("Iniciando...");
  delay(2000);

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Sistema Energia");
  lcd.setCursor(0, 1);
  lcd.print("Calibrando...");

  long soma = 0;
  for (int i = 0; i < 500; i++) {
    soma += analogRead(sensorCorrente);
    delay(2);
  }
  offsetCorrente = soma / 500;

  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Sistema Energia");
  lcd.setCursor(0, 1);
  lcd.print("Inicializado");
  delay(1500);
  lcd.clear();
}

void loop() {
  bool sensorBaixo = (digitalRead(nivelBaixo) == LOW);
  bool sensorAlto = (digitalRead(nivelAlto) == LOW);

  if (!sensorBaixo && !sensorAlto) {
    bombaLigada = true;
  } else if (sensorBaixo && !sensorAlto) {
    bombaLigada = true;
  } else if (sensorBaixo && sensorAlto) {
    bombaLigada = false;
  } else {
    bombaLigada = false;
  }

  digitalWrite(releBomba, bombaLigada ? RELE_LIGADO : RELE_DESLIGADO);

  long somaLeitura = 0;
  for (int i = 0; i < 100; i++) {
    somaLeitura += analogRead(sensorCorrente);
  }
  int leitura = somaLeitura / 100;
  float tensao = (leitura - offsetCorrente) * (5.0 / 1023.0);
  corrente = abs(tensao / 0.066);
  if (corrente < 0.10) {
    corrente = 0;
  }

  String nivel = "INDEFINIDO";
  if (!sensorBaixo && !sensorAlto) {
    nivel = "BAIXO";
  } else if (sensorBaixo && !sensorAlto) {
    nivel = "MEDIO";
  } else if (sensorBaixo && sensorAlto) {
    nivel = "CHEIO";
  }

  String bomba = bombaLigada ? "LIGADA" : "DESLIGADA";
  String alerta = "NORMAL";
  if (corrente > 4.0) {
    alerta = "CORRENTE ALTA";
  }

  // Valores estimados de bateria e placa solar para compatibilidade com o servidor
  float tensaoBateria = 12.3;
  int cargaBateria = 78;
  float tensaoSolar = 18.2;

  if (cargaBateria < 25) {
    alerta = "BATERIA BAIXA";
  }

  String json = "{\"nivel\":\"" + nivel + "\",\"bomba\":\"" + bomba + "\",\"corrente\":" + String(corrente, 2) +
                ",\"tensaoBateria\":" + String(tensaoBateria, 1) +
                ",\"cargaBateria\":" + String(cargaBateria) +
                ",\"tensaoSolar\":" + String(tensaoSolar, 1) +
                ",\"alerta\":\"" + alerta + "\"}";

  Serial.println(json);
  Serial.flush();

  lcd.setCursor(0, 0);
  if (!sensorBaixo && !sensorAlto) {
    lcd.print("Nivel: BAIXO   ");
  } else if (sensorBaixo && !sensorAlto) {
    lcd.print("Nivel: MEDIO   ");
  } else if (sensorBaixo && sensorAlto) {
    lcd.print("Nivel: CHEIO   ");
  } else {
    lcd.print("Erro Sensores ");
  }

  lcd.setCursor(0, 1);
  lcd.print("B:");
  lcd.print(bombaLigada ? "ON " : "OFF");
  lcd.print(" I:");
  lcd.print(corrente, 1);
  lcd.print("A ");

  delay(300);
}
