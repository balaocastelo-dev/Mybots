declare module "qrcode" {
  interface OpcoesQr {
    type?: string;
    margin?: number;
    width?: number;
    errorCorrectionLevel?: string;
    color?: { dark?: string; light?: string };
  }
  interface QRCodeEstatico {
    toString(texto: string, opcoes?: OpcoesQr): Promise<string>;
    toDataURL(texto: string, opcoes?: OpcoesQr): Promise<string>;
  }
  const QRCode: QRCodeEstatico;
  export default QRCode;
}
