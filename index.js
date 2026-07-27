const express = require('express');
const paydunya = require('paydunya');
require('dotenv').config();

const app = express();

// Middleware pour lire le JSON dans les requêtes
app.use(express.json());
// 1. Configuration de PayDunya avec les variables d'environnement
paydunya.setup({
    masterKey: process.env.PAYDUNYA_MASTER_KEY,
    privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
    publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
    token: process.env.PAYDUNYA_TOKEN,
    mode: process.env.PAYDUNYA_MODE || 'test'
});

// NOUVEAU : Configuration obligatoire de la boutique
paydunya.store.name = "Ika-Book";
paydunya.store.tagline = "La librairie en ligne";
paydunya.store.postal_address = "Bamako, Mali"; // Modifie selon ton adresse
paydunya.store.phone_number = "+22300000000"; // Modifie avec ton numéro
paydunya.store.website_url = "https://ika-book.com";

// 2. Route pour créer un paiement (générer une facture PayDunya)
app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient } = req.body;

        // Création de la facture Checkout PayDunya
        const invoice = new paydunya.CheckoutInvoice({
            name: nomClient || "Client Ika-Book",
            total_amount: montant || 100, // Montant par défaut
            description: description || "Paiement de livre",
            return_url: "https://ika-book.com/succes",
            cancel_url: "https://ika-book.com/annulation"
        });

        // Demande de création de la facture auprès de PayDunya
        if (await invoice.create()) {
            // Renvoyer le lien de redirection au client (frontend ou application mobile)
            res.json({
                success: true,
                response_text: invoice.response_text,
                invoice_url: invoice.url, // URL vers laquelle rediriger l'utilisateur pour payer
                token: invoice.token
            });
        } else {
            res.status(400).json({
                success: false,
                message: invoice.response_text
            });
        }
    } catch (error) {
        console.error("Erreur PayDunya :", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// Démarrage du serveur sur le port attribué par Render ou 3000 par défaut
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur démarré sur le port ${PORT} !`);
});

