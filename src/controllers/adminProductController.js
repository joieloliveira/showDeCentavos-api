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

export async function updateAdminProduct(req,res) {
 try {
  const {id}=req.params;
  if(!/^[a-f0-9]{24}$/i.test(id))return res.status(400).json({message:'ID inválido.'});
  const body=req.body;
  if(!body||typeof body!=='object'||Array.isArray(body))return res.status(400).json({message:'Dados inválidos.'});
  const allowed=new Set(['name','description','price','stock','status']);
  const keys=Object.keys(body);
  if(!keys.length||keys.some(key=>!allowed.has(key)))return res.status(400).json({message:'Campos não permitidos.'});
  const patch={};
  if('name' in body) {
   if(typeof body.name!=='string'||body.name.trim().length<3||body.name.trim().length>150)return res.status(400).json({message:'Nome inválido.'});
   patch.name=body.name.trim();
  }
  if('description' in body) {
   if(typeof body.description!=='string'||!body.description.trim()||body.description.length>5000)return res.status(400).json({message:'Descrição inválida.'});
   patch.description=body.description.trim();
  }
  if('price' in body) {
   if(typeof body.price!=='number'||!Number.isFinite(body.price)||body.price<0)return res.status(400).json({message:'Preço inválido.'});
   patch.price=body.price;
  }
  if('stock' in body) {
   if(!Number.isSafeInteger(body.stock)||body.stock<0)return res.status(400).json({message:'Estoque inválido.'});
   patch.stock=body.stock;
  }
  if('status' in body) {
   if(!['draft','active','inactive'].includes(body.status))return res.status(400).json({message:'Situação inválida.'});
   patch.status=body.status;
  }
  const product=await Product.findById(id);
  if(!product)return res.status(404).json({message:'Produto não encontrado.'});
  if(patch.stock!==undefined&&patch.stock<product.reservedStock)return res.status(409).json({message:'Estoque menor que as reservas existentes.'});
  Object.assign(product,patch);
  await product.save();
  return res.json({product});
 }catch(error){console.error('Admin product update:',error);return res.status(500).json({message:'Erro ao atualizar produto.'});}
}
