const express = require('express');
const paydunya = require('paydunya');
require('dotenv').config();

const app = express();
app.use(express.json());

// 1. Initialiser le Setup avec le constructeur
const setup = new paydunya.Setup({
    masterKey: process.env.PAYDUNYA_MASTER_KEY,
    privateKey: process.env.PAYDUNYA_PRIVATE_KEY,
    publicKey: process.env.PAYDUNYA_PUBLIC_KEY,
    token: process.env.PAYDUNYA_TOKEN,
    mode: process.env.PAYDUNYA_MODE || 'test'
});

// 2. Initialiser le Store avec le constructeur
const store = new paydunya.Store({
    name: "Ika-Book", // Requis par la ligne 8 !
    tagline: "La librairie en ligne",
    postal_address: "Bamako, Mali",
    phone_number: "+22300000000",
    website_url: "https://ika-book.com"
});

app.post('/creer-paiement', async (req, res) => {
    try {
        const { montant, description, nomClient } = req.body;

        // 3. Injecter setup et store dans la facture
        const invoice = new paydunya.CheckoutInvoice(setup, store);

        // 4. Configurer le montant (Requis par la ligne 91) et la description
        invoice.totalAmount = montant;
        invoice.description = description;

        // Optionnel mais recommandé : Ajouter un article pour le reçu
        invoice.addItem("Achat Ika-Book", 1, montant, montant, description);

        // 5. Lancer la création de la facture vers l'API
        await invoice.create();

        // 6. Succès ! Retourner le lien de paiement généré
        res.json({
            success: true,
            url: invoice.url,
            token: invoice.token
        });

    } catch (error) {
        console.error("Erreur PayDunya:", error);
        res.status(500).json({ 
            success: false, 
            error: error.message,
            details: error.data || "Aucun détail supplémentaire"
        });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Serveur démarré sur le port ${PORT} !`));

