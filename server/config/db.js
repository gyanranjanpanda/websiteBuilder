import mongoose from "mongoose"
import dns from "dns"

const connectDb = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URL, {
            family: 4,
            serverSelectionTimeoutMS: 10000,
        })
        console.log("db connected")
    } catch (error) {
        console.log("db error:", error.message)
    }
}

export default connectDb