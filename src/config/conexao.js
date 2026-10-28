import mongoose from "mongoose";

const conectarMongoDB = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);

    console.log("MongoDB conectado com sucesso!");
  } catch (error) {
    console.error("Erro ao conectar ao MongoDB:", error.message);
    process.exit(1);
  }
};

export default conectarMongoDB;