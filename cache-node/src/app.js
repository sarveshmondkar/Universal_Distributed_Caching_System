import express from "express";
import cacheRoutes from "./routes/cache.route.js"

const app = express();

//Middleware
app.use(express.json());
app.use(express.urlencoded({extended:true}));

//Routes
app.use("/cache", cacheRoutes);


export default app;