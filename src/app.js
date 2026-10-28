import express from "express";
import cors from "cors";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import productRoutes from "./routes/productRoutes.js";
import siteSettingsRoutes from "./routes/siteSettingsRoutes.js";
import categoryRoutes from "./routes/categoryRoutes.js";
import sellerRoutes from "./routes/sellerRoutes.js";
import reviewRoutes from "./routes/reviewRoutes.js";
import orderRoutes from "./routes/orderRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import mercadoPagoRoutes from "./routes/mercadoPagoRoutes.js";
import auctionRoutes from "./routes/auctionRoutes.js";
import walletRoutes from "./routes/walletRoutes.js";

const app = express();

app.use(cors());
app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/products", productRoutes);
app.use("/api/site-settings", siteSettingsRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/sellers", sellerRoutes);
app.use("/api/reviews", reviewRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/mercadopago", mercadoPagoRoutes);
app.use("/api/auctions", auctionRoutes);
app.use("/api/wallet", walletRoutes);

export default app;