const express = require('express');[span_0](start_span)[span_0](end_span)
const cors = require('cors');[span_1](start_span)[span_1](end_span)
const paydunya = require('paydunya');[span_2](start_span)[span_2](end_span)
const crypto = require('crypto');[span_3](start_span)[span_3](end_span)
require('dotenv').config();[span_4](start_span)[span_4](end_span)

const app = express();[span_5](start_span)[span_5](end_span)

// 1. Activer CORS et le parsing[span_6](start_span)[span_6](end_span)
app.use(cors());[span_7](start_span)[span_7](end_span)
app.use(express.json());[span_8](start_span)[span_8](end_span)
app.use(express.urlencoded({ extended: true }));[span_9](start_span)[span_9](end_span)

// 2. Initialiser le Setup PayDunya[span_10](start_span)[span_10](end_span)
const setup = new paydunya.Setup({
    masterKey: process.env.PAYDUNYA_MASTER_KEY,[span_11](start_span)[span_11](end_span)
    privateKey: process.env.PAYDUNYA_PRIVATE_KEY,[span_12](start_span)[span_12](end_span)
    publicKey: process.env.PAYDUNYA_PUBLIC_KEY,[span_13](start_span)[span_13](end_span)
    token: process.env.PAYDUNYA_TOKEN,[span_14](start_span)[span_14](end_span)
    mode: process.env.PAYDUNYA_MODE || 'test[span_15](start_span)'[span_15](end_span)
});

// 3. Initialiser le Store PayDunya[span_16](start_span)[span_16](end_span)
const store = new paydunya.Store({
    name: "Ika-Book",[span_17](start_span)[span_17](end_span)
    tagline: "Vente de livres en ligne",[span_18](start_span)[span_18](end_span)
    postalAddress: "Adresse de la boutique",[span_19](start_span)[span_19](end_span)
    phoneNumber: "Numéro de téléphone",[span_20](start_span)[span_20](end_span)
    websiteURL: "https://ika-book.com",[span_21](start_span)[span_21](end_span)
    logoURL: "https://ika-book.com/logo.png",[span_22](start_span)[span_22](end_span)
    callbackURL: "https://api.ika-book.com/webhook" // URL de votre serveur[span_23](start_span)[span_23](end_span)
});

// Stockage temporaire des transactions pour le polling (Idéalement Redis ou une DB)
const transactions = {}; 

// 4. Route pour la création de facture via le Worker
app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient, userId, creditsRequested } = req.body;

        const invoice = new paydunya.CheckoutInvoice(setup, store);[span_24](start_span)[span_24](end_span)
        invoice.addItem(description || "Achat Ika-Book", 1, montant, montant);[span_25](start_span)[span_25](end_span)
        invoice.totalAmount = montant;[span_26](start_span)[span_26](end_span)

        await invoice.create();[span_27](start_span)[span_27](end_span)

        if (invoice.url) {[span_28](start_span)[span_28](end_span)
            // On enregistre la transaction comme "en attente" avec ses métadonnées
            transactions[invoice.token] = {
                status: 'pending',
                userId: userId,
                credits: creditsRequested
            };

            res.status(200).json({
                success: true,[span_29](start_span)[span_29](end_span)
                invoice_url: invoice.url,[span_30](start_span)[span_30](end_span)
                token: invoice.token,[span_31](start_span)[span_31](end_span)
                message: "Facture générée"
            });
        } else {
            res.status(400).json({ success: false, message: invoice.responseText || "Erreur" });[span_32](start_span)[span_32](end_span)
        }
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });[span_33](start_span)[span_33](end_span)
    }
});

// 5. Route IPN (Webhook) appelée par PayDunya
app.post('/webhook', async (req, res) => {
    try {
        const data = req.body.data;[span_34](start_span)[span_34](end_span)
        if (!data) return res.status(400).send("Aucune donnée reçue");[span_35](start_span)[span_35](end_span)

        const { status, hash, invoice } = data;[span_36](start_span)[span_36](end_span)
        
        const masterKeyHash = crypto[span_37](start_span)[span_37](end_span)
            .createHash('sha512')[span_38](start_span)[span_38](end_span)
            .update(process.env.PAYDUNYA_MASTER_KEY)[span_39](start_span)[span_39](end_span)
            .digest('hex');[span_40](start_span)[span_40](end_span)

        if (hash === masterKeyHash) {[span_41](start_span)[span_41](end_span)
            if (status === "completed") {[span_42](start_span)[span_42](end_span)
                // Mise à jour du statut pour le polling
                if(transactions[invoice.token]) {
                    transactions[invoice.token].status = 'completed';
                    
                    // TODO: Exécuter la logique S2S pour créditer l'utilisateur ici
                    // Exemple : fetch('https://apigemini.ladjitraore5995.workers.dev/api/add-credits', ...)
                }
            } else if (status === "cancelled") {
                if(transactions[invoice.token]) {
                    transactions[invoice.token].status = 'cancelled';
                }
            }
            res.status(200).send("Notification traitée");[span_43](start_span)[span_43](end_span)
        } else {
            res.status(403).send("Signature invalide");[span_44](start_span)[span_44](end_span)
        }
    } catch (error) {
        res.status(500).send("Erreur interne du serveur");[span_45](start_span)[span_45](end_span)
    }
});

// 6. Nouvelle route de polling pour le frontend/worker
app.get('/statut-paiement/:token', (req, res) => {
    const token = req.params.token;
    const transaction = transactions[token];
    
    if (transaction) {
        res.status(200).json({ success: true, status: transaction.status });
    } else {
        res.status(404).json({ success: false, status: 'unknown' });
    }
});

const PORT = process.env.PORT || 3000;[span_46](start_span)[span_46](end_span)
app.listen(PORT, () => console.log(`Serveur en écoute sur le port ${PORT}`));[span_47](start_span)[span_47](end_span)
