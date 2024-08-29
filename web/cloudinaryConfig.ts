import { v2 as cloudinary } from "cloudinary";
import v2 from "cloudinary-core";

const cloudinaryConfig = cloudinary.config({
  cloud: {
    cloudName: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    apiKey: process.env.CLOUDINARY_API_KEY,
    apiSecret: process.env.CLOUDINARY_API_SECRET,
  },
});

export default cloudinaryConfig;
