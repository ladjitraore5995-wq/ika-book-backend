const express = require('express');
const cors = require('cors'); // 1. Importer CORS
const paydunya = require('paydunya');
require('dotenv').config();

const app = express();

// 2. Activer CORS et le parsing JSON
app.use(cors());
app.use(express.json());

// 3. Initialiser le Setup PayDunya
const setup = new paydunya.Setup({
    masterKey: process.env.PAYDUNYA_MASTER_KEY,
    privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
    publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
    token: process.env.PAYDUNYA_TOKEN,
    mode: process.env.PAYDUNYA_MODE || 'test'
});

// 4. Initialiser le Store PayDunya
const store = new paydunya.Store({
    name: "Ika-Book",
    tagline: "Vente de livres en ligne",
    postal_address: "Adresse de la boutique",
    phone_number: "Numéro de téléphone",
    website_url: "https://ika-book.com",
    logo_url: "https://ika-book.com/logo.png"
});

// 5. Route pour la création de facture
app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient } = req.body;

        // Initialisation de la facture Checkout PayDunya
        const invoice = new paydunya.CheckoutInvoice(setup, store);
        
        // Ajout de l'article (description, quantité, prix unitaire, prix total)
        invoice.addItem(description || "Achat Ika-Book", 1, montant, montant);
        invoice.totalAmount = montant;

        // Création de la facture via l'API PayDunya
        const success = await invoice.create();

        if (success) {
            res.json({
                success: true,
                invoice_url: invoice.invoice_url,
                token: invoice.token
            });
        } else {
            res.status(400).json({
                success: false,
                message: invoice.response_text || "Erreur lors de la création de la facture"
            });
        }
    } catch (error) {
        console.error("Erreur serveur:", error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 6. Démarrer le serveur Express
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur en écoute sur le port ${PORT}`);
});

