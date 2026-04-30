import app from "./app";

const PORT = parseInt(process.env.PORT || "5000", 10);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`API Server running on http://0.0.0.0:${PORT}`);
});

export default app;
