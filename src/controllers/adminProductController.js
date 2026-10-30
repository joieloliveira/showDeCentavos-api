import Product from '../models/Product.js';
export async function listAdminProducts(req,res) {
 try {
  const products=await Product.find({}).select('name slug description price stock status coverImage createdAt').sort({createdAt:-1}).limit(100).lean();
  return res.json({products});
 } catch(error) {console.error('Admin products list:',error);return res.status(500).json({message:'Erro ao listar produtos.'});}
}
export async function createAdminProduct(req,res) {
 try {
  const {name,slug,description,price,stock}=req.body ?? {};
  if(typeof name!=='string'||name.trim().length<3||name.trim().length>150||
    typeof slug!=='string'||!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>150||
    typeof description!=='string'||!description.trim()||description.length>5000||
    typeof price!=='number'||!Number.isFinite(price)||price<0||
    !Number.isSafeInteger(stock)||stock<0) return res.status(400).json({message:'Dados do produto inválidos.'});
  if(await Product.exists({slug})) return res.status(409).json({message:'Este identificador já está em uso.'});
  const product=await Product.create({seller:req.user.id,name:name.trim(),slug,description:description.trim(),price,stock,status:'draft'});
  return res.status(201).json({product});
 } catch(error) {
  if(error?.code===11000)return res.status(409).json({message:'Identificador já cadastrado.'});
  console.error('Admin product create:',error);
  return res.status(500).json({message:'Erro ao cadastrar produto.'});
 }
}
