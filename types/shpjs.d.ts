declare module 'shpjs' {
  const shp: (input: ArrayBuffer | string) => Promise<any>;
  export default shp;
}
