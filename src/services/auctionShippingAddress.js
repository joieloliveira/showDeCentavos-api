const required = {
  recipientName: 120,
  phone: 20,
  zipCode: 9,
  street: 160,
  number: 20,
  neighborhood: 100,
  city: 100,
  state: 2,
};

export function validateAuctionShippingAddress(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("Endereço inválido.");
  }
  const address = {};
  for (const [key, max] of Object.entries(required)) {
    if (typeof input[key] !== "string") throw new Error(`Campo obrigatório: ${key}.`);
    address[key] = input[key].trim();
    if (!address[key] || address[key].length > max) throw new Error(`Campo inválido: ${key}.`);
  }
  address.zipCode = address.zipCode.replace(/\D/g, "");
  address.phone = address.phone.replace(/\D/g, "");
  address.state = address.state.toUpperCase();
  if (!/^\d{8}$/.test(address.zipCode)) throw new Error("CEP inválido.");
  if (!/^\d{10,11}$/.test(address.phone)) throw new Error("Telefone inválido.");
  if (!/^[A-Z]{2}$/.test(address.state)) throw new Error("UF inválida.");
  if (typeof input.complement !== "undefined" && typeof input.complement !== "string") {
    throw new Error("Complemento inválido.");
  }
  address.complement = (input.complement || "").trim();
  if (address.complement.length > 120) throw new Error("Complemento muito longo.");
  address.country = "BR";
  return address;
}
