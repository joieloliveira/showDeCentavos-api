import {
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

import crypto from "crypto";

import storage from "../config/storage.js";

const generateFileName = (originalName) => {
  const extension = originalName
    .split(".")
    .pop()
    .toLowerCase();

  const randomName = crypto.randomUUID();

  return `${randomName}.${extension}`;
};

export const uploadImage = async (
  file,
  folder = "images"
) => {
  const fileName = generateFileName(
    file.originalname
  );

  const key = `${folder}/${fileName}`;

  await storage.send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET,

      Key: key,

      Body: file.buffer,

      ContentType: file.mimetype,
    })
  );

  const url =
    `${process.env.R2_PUBLIC_URL}/${key}`;

  return {
    key,
    url,
  };
};

export const deleteImage = async (key) => {
  await storage.send(
    new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET,
      Key: key,
    })
  );
};