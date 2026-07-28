const express = require('express');
const cors = require('cors');
const paydunya = require('paydunya');
const crypto = require('crypto');
const axios = require('axios'); // Ajouté pour faciliter les requêtes vers l'API PUSH
require('dotenv').config();

const app = express();

// 1. Configuration des Middlewares
// On autorise spécifiquement ton domaine pour des raisons de sécurité
const corsOptions = {
    origin: ['https://ika-book.com', 'https://www.ika-book.com', 'http://localhost:3000'],
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 2. Initialisation du Setup PayDunya (PAR & PSR)
const setup = new paydunya.Setup({
    masterKey: process.env.PAYDUNYA_MASTER_KEY,
    privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
    publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
    token: process.env.PAYDUNYA_TOKEN,
    mode: process.env.PAYDUNYA_MODE || 'test' // 'test' ou 'live'
});

const store = new paydunya.Store({
    name: "Ika-Book",
    tagline: "Vente de livres en ligne",
    postalAddress: "Adresse de la boutique",
    phoneNumber: "Numéro de téléphone",
    websiteURL: "https://ika-book.com",
    logoURL: "https://ika-book.com/logo.png",
    callbackURL: "https://api.ika-book.com/webhook" // Ton URL backend sur Render
});

// ==========================================
// ROUTE PSR (PAIEMENT SANS REDIRECTION)
// ==========================================

// Le frontend fera un appel GET vers cette route pour récupérer le token JSON
app.get('/paydunya-api', async (req, res) => {
    try {
        // On récupère le montant depuis l'URL (ex: ?amount=5000), sinon on fixe un défaut
        const montant = req.query.amount ? parseInt(req.query.amount) : 1000;
        
        const invoice = new paydunya.CheckoutInvoice(setup, store);
        invoice.addItem("Achat Ika-Book (PSR)", 1, montant, montant);
        invoice.totalAmount = montant;

        await invoice.create();

        if (invoice.token) {
            // Réponse formatée exactement comme l'exige la documentation PSR
            res.status(200).json({
                success: true,
                mode: process.env.PAYDUNYA_MODE || 'test',
                token: invoice.token
            });
        } else {
            res.status(400).json({ success: false, message: invoice.responseText });
        }
    } catch (error) {
        console.error("Erreur PSR:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ==========================================
// ROUTES PUSH (DEBOURSEMENT)
// ==========================================

// Fonction utilitaire pour générer les headers de l'API PUSH
const getPushHeaders = () => ({
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': process.env.PAYDUNYA_MASTER_KEY,
    'PAYDUNYA-PRIVATE-KEY': process.env.PAYDUNYA_PRIVATE_KEY,
    'PAYDUNYA-TOKEN': process.env.PAYDUNYA_TOKEN
});

// Étape 1 : Initiation du déboursement (Obtenir l'invoice)
app.post('/api/push/init', async (req, res) => {
    try {
        const { account_alias, amount, withdraw_mode } = req.body;

        const response = await axios.post('https://app.paydunya.com/api/v2/disburse/get-invoice', {
            account_alias,
            amount: parseInt(amount),
            withdraw_mode, // ex: 'orange-money-senegal', 'paydunya', etc.
            callback_url: "https://api.ika-book.com/webhook" 
        }, { headers: getPushHeaders() });

        res.status(200).json(response.data);
    } catch (error) {
        console.error("Erreur Init PUSH:", error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, error: error.response ? error.response.data : "Erreur interne" });
    }
});

// Étape 2 : Soumission du déboursement
app.post('/api/push/submit', async (req, res) => {
    try {
        const { disburse_invoice, disburse_id } = req.body;

        const payload = { disburse_invoice };
        if (disburse_id) payload.disburse_id = disburse_id; // Optionnel

        const response = await axios.post('https://app.paydunya.com/api/v2/disburse/submit-invoice', 
            payload, 
            { headers: getPushHeaders() }
        );

        res.status(200).json(response.data);
    } catch (error) {
        console.error("Erreur Submit PUSH:", error.response ? error.response.data : error.message);
        res.status(500).json({ success: false, error: error.response ? error.response.data : "Erreur interne" });
    }
});

// ==========================================
// WEBHOOK (IPN) - RÉCEPTION DES NOTIFICATIONS
// ==========================================

app.post('/webhook', (req, res) => {
    try {
        const data = req.body.data || req.body; // Tolérance selon le format exact envoyé par PayDunya
        
        if (!data || !data.hash) {
            return res.status(400).send("Données invalides");
        }

        const masterKeyHash = crypto
            .createHash('sha512')
            .update(process.env.PAYDUNYA_MASTER_KEY)
            .digest('hex');

        if (data.hash === masterKeyHash) {
            if (data.status === "completed" || data.status === "success") {
                // TODO: Mettre à jour la base de données (Commande client ou Déboursement)
                console.log(`Transaction validée : ${data.status}`);
            }
            res.status(200).send("Notification traitée avec succès");
        } else {
            console.error("Alerte Sécurité: Signature invalide détectée");
            res.status(403).send("Signature invalide");
        }
    } catch (error) {
        console.error("Erreur Webhook:", error);
        res.status(500).send("Erreur interne du serveur");
    }
});

// 3. Lancement du serveur
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Serveur Ika-Book API opérationnel sur le port ${PORT}`);
});
