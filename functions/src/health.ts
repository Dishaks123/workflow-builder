export default async function health() {
  return {
    status: "ok",
    service: "workflow-builder",
    timestamp: new Date().toISOString()
  };
}
